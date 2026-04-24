---
title: "AWS Private EC2 Operations Guide Part 1: Why Private Subnet? — The ALB + NAT Gateway Standard Architecture and Sizing-Based Decision Criteria"
description: "We unpack the 'why' behind the standard pattern of placing EC2 in a Private Subnet wrapped by ALB and NAT Gateway. Public IPv4 vs Elastic IP, sizing recommendations, HA basics, and the concrete risks of putting PII-handling servers in a Public Subnet. Part 1 of a Bastion-less AWS EC2 operations series."
pubDate: "2026-04-24T10:00:00+09:00"
tags: ["AWS", "EC2", "VPC", "Architecture", "Private Subnet", "ALB", "NAT Gateway"]
heroImage: "../../../assets/AwsPrivateEc2Guide1.png"
lang: en
---

## Introduction

"Put your EC2 in a Private Subnet and wrap it with an ALB and a NAT Gateway" — you'll see this advice after a few minutes of Googling AWS. But most guides jump straight to Terraform code without explaining **why**. This series starts with that missing piece.

Over five parts, we cover a practical playbook for running EC2 in a Private Subnet on AWS: connecting without a Bastion via SSM, deploying with GitHub Actions, and optimizing cost. Part 1 is **about the "why"** — the groundwork you need before moving on to Part 2.

- **Part 1 — Why Private Subnet? (this post)**
- Part 2 — Building the VPC infrastructure with Terraform
- Part 3 — Connecting without Bastion using SSM Session Manager
- Part 4 — CI/CD pipeline with GitHub Actions + SSM/CodeDeploy
- Part 5 — Cost analysis and optimization strategies

The target reader is a junior engineer who has "followed a tutorial to launch an EC2 but doesn't really understand why Private Subnet or NAT Gateway are needed." After this post, you should walk away thinking **"ah, so that's why we do it this way."**

---

## 1. The Standard Architecture

### 1.1 Topology

```text
Internet
   ↓
[ ALB ]          ← Public Subnet
   ↓
[ EC2 ]          ← Private Subnet
   ↓
[ NAT Gateway ]  ← Public Subnet (outbound only)
   ↓
Internet
```

### 1.2 Role of Each Component

- **EC2 lives in the Private Subnet.** It has no public IP and cannot be reached directly from the internet. Inbound traffic arrives only through the ALB.
- **ALB lives in the Public Subnet.** It accepts HTTP/HTTPS traffic from the internet and routes it to the Private EC2s behind it. It is the "front door" for your service.
- **NAT Gateway also lives in the Public Subnet.** It is an **outbound-only** channel so EC2 can call external APIs, pull OS patches, or ship logs outward. Reverse access (internet → EC2) is not possible through it.
- **Multi-AZ is the production baseline.** ALB, NAT Gateway, and EC2 are all spread across at least two AZs so that a single AZ failure doesn't take the service down.

One principle sums it up: **"Inbound only via ALB, outbound only via NAT, everything else blocked."**

### 1.3 Glossary for This Series

Bookmark this table and come back when acronyms blur together.

| Acronym | Meaning |
| --- | --- |
| VPC | Virtual Private Cloud. Your own virtual network inside AWS |
| Subnet | An IP range inside a VPC. Split into Public (internet-connected) and Private (internal only) |
| ALB | Application Load Balancer. An L7 load balancer that distributes traffic across multiple EC2s |
| NAT | Network Address Translation. Lets Private Subnet EC2s reach the internet outbound |
| AZ | Availability Zone. A physically separated datacenter inside a region. Seoul has 2a, 2b, 2c, 2d |
| SG | Security Group. Instance-level firewall attached to EC2/ALB/etc. |
| NACL | Network Access Control List. Subnet-level firewall |
| IAM | Identity and Access Management. AWS's permissions system |
| SSM | AWS Systems Manager. An umbrella service for EC2 management (Session Manager, Run Command, etc.) |
| CloudTrail | AWS API call audit log — automatically records who did what, when |

---

## 2. Aside: Public IPv4 vs Elastic IP

In this architecture, EC2 has no public IP at all. But for readers who've only used Public Subnets, it's worth clarifying the difference.

When an EC2 sits in a Public Subnet, it gets a public IP — and that comes in two flavors.

|  | Public IPv4 | Elastic IP (EIP) |
| --- | --- | --- |
| Allocation | Auto-assigned when EC2 starts | Manually allocated by the user |
| Lifetime | Changes on stop/start | Fixed until explicitly released |
| Cost | $0.005/hour (since Feb 2024) | Same when attached to a running EC2. **Also billed while unattached** |
| Use case | Temporary testing; no need for a stable IP | DNS records, IP allowlists, external integrations |
| Attaches to | Automatically to an EC2 | Manually to EC2, NAT Gateway, NLB, etc. |

> [!NOTE]
> Stop → start an EC2 and the Public IPv4 changes. If you pointed DNS at that IP, the connection breaks. Use an EIP when you need a stable IP. But watch out: EIPs allocated without being attached still incur charges. AWS added this penalty because IPv4 is scarce — "don't hoard addresses you don't use."

**Relation to this architecture**: EC2 in a Private Subnet has neither a Public IPv4 nor an EIP, because there's no external exposure in the first place. Inbound is handled by the ALB, outbound by the NAT Gateway. This is one of the reasons Private Subnets are more secure by design.

---

## 3. Do You Actually Need This Architecture? — Sizing-Based Judgment

> [!NOTE]
> Honestly, for small-scale systems, ALB + Private Subnet + NAT Gateway can be over-engineering. NAT Gateway alone costs $43+/month, and ALB adds $20+ — infrastructure can end up costing more than the service itself.

"Standard architecture" doesn't mean every service must adopt it. Shoving production topology into a side project wastes money, but cutting corners on a service that handles PII creates real risk. Here's where the boundary actually sits.

### 3.1 Recommended Setups by Scale

| Setup | Approx. monthly cost | Best fit |
| --- | --- | --- |
| EC2 Public Subnet + Security Group | ~$40 | Side projects, solo operators. SG-based port restrictions are enough |
| EC2 + Nginx (reverse proxy) | ~$40 | No ALB — handle routing directly with Nginx on EC2 |
| Lightsail | $10~40 | Cheapest. Flat rate, no VPC design required |
| ALB + Private EC2 + NAT Instance | ~$60 | Keep the security posture, cut NAT Gateway cost with a NAT Instance |
| ALB + Private EC2 + NAT Gateway (this series) | $100~320 | Mid-scale and up, compliance requirements, multi-person teams |

### 3.2 When Does a Private Subnet Become Necessary?

Concrete criteria for drawing the line between small-scale and mid-scale:

| Metric | Small-scale (Public Subnet OK) | Mid-scale and up (Private Subnet recommended) |
| --- | --- | --- |
| Daily traffic | ~100K requests or fewer | 100K+ requests |
| EC2 count | 1 instance | 2+ instances (HA needed) |
| Operators | 1–2 people | 3+ (access control required) |
| Budget ratio | Infra is 10%+ of revenue | Infra is 5% or less of revenue |
| Compliance | None | Financial, healthcare, PII regulations |
| Availability requirement | Downtime tolerable | 99.9%+ SLA |
| Data sensitivity | Mostly public data | PII, payment data |

If even one row lands on the right side, it's time to consider a Private Subnet — especially **compliance and data sensitivity**, which push you to the mid-scale column regardless of traffic volume.

### 3.3 Aside: What Is HA (High Availability)?

The table above mentions "2+ EC2 instances" and "99.9%+ SLA." Both tie directly to HA, so a quick primer.

HA means **"the service stays alive and doesn't die."** ALB is one of the tools that help achieve HA.

```text
HA (goal) = "the service must always be up"
  ├─ Lever 1: Run 2+ EC2s (if one dies, the others handle requests)
  ├─ Lever 2: Use ALB to spread traffic (only send requests to healthy EC2s)
  └─ Lever 3: Multi-AZ placement (if one AZ fails, another keeps running)
```

If you run a single EC2, the moment it dies the service is gone. With two or more, one can die and the rest keep serving — that "can survive one death" state is HA. ALB distributes traffic across them and automatically drops unhealthy instances out of rotation.

> [!NOTE]
> **Core decision point**: Can you justify the $60–140/month that Private Subnet architecture adds? Spending $140 on a side project that runs fine on $40 is wasteful. Spending $40 on a service that handles PII just to save money is reckless. Detailed cost analysis comes in Part 5.

Concretely, you need a Private Subnet when:

- Traffic is high enough that ALB's load balancing is actually doing work
- You run 2+ EC2 instances and availability matters
- You have compliance requirements (finance, healthcare, PII)
- Team size grew and you need access control

---

## 4. PII + Public Subnet: Three Concrete Risks

Above we said "cutting costs by leaving PII-handling servers in a Public Subnet is a risk." That's not a vague warning — it breaks down into three specific risks.

### 4.1 Direct Attack Surface Exposure

- EC2 in a Public Subnet has a public IP, meaning it is **directly reachable from the internet**.
- A single Security Group mistake can expose database ports (3306, 5432, etc.) or SSH (22) to the entire world. These misconfigurations cause real incidents every year.
- Public IPs themselves are **automatic targets for bots and scanners**. Spin up an EC2 on AWS and within minutes your logs will show SSH brute-force attempts.
- If a server holding PII is directly exposed, a breach leads **straight to data exfiltration**. Attackers skip the usual "web tier → internal network → DB" pivot.
- With a Private Subnet architecture, all inbound traffic goes through the ALB — you get **an extra defense layer**. The ALB can block anomalous requests at L7, and with WAF attached you can detect and block attack patterns.

### 4.2 Compliance Violations

- Regulations like Korea's Personal Information Protection Act and ISMS-P include **network isolation requirements**. They mandate that "systems processing personal information must be physically or logically separated from external networks."
- During an audit, "the PII-handling server sits in a Public Subnet and is exposed via a public IP" is itself a **finding**. It can be classified as insufficient technical safeguards.
- After an incident, it becomes **evidence that the company did not take reasonable protective measures**, widening the scope of legal liability.

### 4.3 Broader Liability After an Incident

- A Private Subnet + ALB setup lets you argue **"we applied the standard security architecture"** — evidence that you followed AWS Well-Architected's security guidance.
- Leaving the server in a Public Subnet exposes you to the judgment that **"security was neglected to cut costs."**
- That judgment **directly affects fines and damages awarded** in court. The wider the fault, the bigger the payout.

> [!NOTE]
> **Bottom line**: For a side project that only handles public data, Public Subnet + Security Group is fine. But the moment PII (user data, payment information, sensitive records) is involved, network-level isolation (Private Subnet) is **insurance, not cost**. Weigh the extra $60–100/month against potential fines and reputational damage, and the direction is obvious.

In practice, the pragmatic path is: **start with Public Subnet + SG for small scale, and migrate to Private Subnet architecture when scale or data sensitivity changes**. You don't need to go full-fledged from day one — but when the nature of your data shifts, don't hesitate.

---

## Recap

Key takeaways from this post:

1. **The standard architecture is "ALB + Private EC2 + NAT Gateway."** Inbound only via ALB, outbound only via NAT, everything else blocked.
2. **Understand Public IPv4 vs EIP** to see why neither is needed in this architecture — there's no external exposure at all.
3. **Not every service needs this setup.** A $40/month Public Subnet + SG is reasonable for small side projects. Move to Private Subnet when scale or compliance demands it.
4. **HA means "2+ EC2s + ALB + Multi-AZ."** This is often the practical tipping point that forces you into a Private Subnet architecture.
5. **PII + Public Subnet has three concrete risks**: direct attack exposure, compliance violations, and broader liability after incidents. The moment PII is involved, Private Subnet is insurance, not cost.

Part 1 had one goal — **making the architecture make sense**. If you now think "oh, that's why we do it this way" when you see a Private Subnet diagram, we're done here. Part 2 starts building this architecture in actual code.

In the next post — **Building VPC Infrastructure with Terraform** — we design the VPC CIDR, lay out 2AZ Public/Private subnets, wire up route tables, use the "SG-references-SG" pattern for Security Groups, and stand up ALB and EC2 in a single `main.tf` that comes up with one `terraform apply`.
