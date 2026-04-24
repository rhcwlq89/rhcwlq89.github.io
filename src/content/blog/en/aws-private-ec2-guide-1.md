---
title: "AWS Private EC2 Operations Guide Part 1: Why Private Subnet? — The ALB + NAT Gateway Standard Architecture and Sizing-Based Decision Criteria"
description: "We unpack the 'why' behind the standard pattern of placing EC2 in a Private Subnet wrapped by ALB and NAT Gateway. Public IPv4 vs Elastic IP, sizing recommendations, HA basics, and the concrete risks of putting PII-handling servers in a Public Subnet. Part 1 of a Bastion-less AWS EC2 operations series."
pubDate: "2026-04-24T10:00:00+09:00"
tags: ["AWS", "EC2", "VPC", "Architecture", "Private Subnet", "ALB", "NAT Gateway"]
heroImage: "../../../assets/AwsPrivateEc2Guide1.png"
lang: en
---

## Introduction

"Put your EC2 in a Private Subnet and wrap it with an ALB and a NAT Gateway" — you'll see this advice after a few minutes of Googling AWS. But most guides jump straight to Terraform code without explaining <strong>why</strong>. This series starts with that missing piece.

Over five parts, we cover a practical playbook for running EC2 in a Private Subnet on AWS: connecting without a Bastion via SSM, deploying with GitHub Actions, and optimizing cost. Part 1 is <strong>about the "why"</strong> — the groundwork you need before moving on to Part 2.

- <strong>Part 1 — Why Private Subnet? (this post)</strong>
- Part 2 — Building the VPC infrastructure with Terraform
- Part 3 — Connecting without Bastion using SSM Session Manager
- Part 4 — CI/CD pipeline with GitHub Actions + SSM/CodeDeploy
- Part 5 — Cost analysis and optimization strategies

The target reader is a junior engineer who has "followed a tutorial to launch an EC2 but doesn't really understand why Private Subnet or NAT Gateway are needed." After this post, you should walk away thinking <strong>"ah, so that's why we do it this way."</strong>

---

## 1. The Standard Architecture

### 1.1 Topology

```mermaid
flowchart TB
    I1([Internet])
    I2([Internet])
    subgraph VPC["VPC (10.0.0.0/16)"]
        subgraph Public["Public Subnet"]
            ALB[ALB]
            NAT["NAT Gateway<br/>(outbound only)"]
        end
        subgraph Private["Private Subnet"]
            EC2[EC2]
        end
    end
    I1 -->|inbound| ALB
    ALB --> EC2
    EC2 -->|outbound| NAT
    NAT --> I2
```

### 1.2 Role of Each Component

One common point of confusion first: <strong>the VPC is the outer box enclosing ALB, NAT Gateway, and EC2 — all three</strong>. Saying "ALB and NAT live in the Public Subnet" doesn't mean they sit outside the VPC; they're placed in a Public Subnet, which is a zone <strong>inside</strong> the same VPC. Public vs Private isn't physical isolation — it's a <strong>route table</strong> difference. Public Subnets have a route to the Internet Gateway; Private Subnets don't. (The actual route table code comes in Part 2.)

- <strong>EC2 lives in the Private Subnet.</strong> It has no public IP and cannot be reached directly from the internet. Inbound traffic arrives only through the ALB.
- <strong>ALB lives in the Public Subnet.</strong> It accepts HTTP/HTTPS traffic from the internet and routes it to the Private EC2s behind it. It is the "front door" for your service.
- <strong>NAT Gateway also lives in the Public Subnet.</strong> It is an <strong>outbound-only</strong> channel so EC2 can call external APIs, pull OS patches, or ship logs outward. Reverse access (internet → EC2) is not possible through it.
- <strong>Multi-AZ is the production baseline.</strong> ALB, NAT Gateway, and EC2 are all spread across at least two AZs so that a single AZ failure doesn't take the service down.

One principle sums it up: <strong>"Inbound only via ALB, outbound only via NAT, everything else blocked."</strong>

### 1.3 Aside: Subnet ↔ AZ Relationship, and What Multi-AZ Actually Means

Earlier we said "Multi-AZ placement is the production baseline" — but it's worth a short detour to see what that actually looks like. Start with how Subnets, AZs, and the VPC relate.

<strong>Three key facts</strong>:

1. <strong>A Subnet belongs to exactly one AZ.</strong> When you create a Subnet, you must pick an AZ for it. You cannot put EC2s from different AZs into the same Subnet.
2. <strong>A VPC spans the entire region.</strong> Within one VPC, create a Subnet per AZ and you naturally end up with a Multi-AZ setup.
3. <strong>A single ALB spans multiple AZs.</strong> When creating an ALB, attach it to Public Subnets across multiple AZs and AWS automatically handles cross-AZ routing. <strong>Do not create an ALB per AZ</strong> — that splits the DNS endpoint in two and defeats the ALB's built-in HA.

<strong>What a 2-AZ Multi-AZ setup actually looks like</strong>:

```mermaid
flowchart TB
    Internet([Internet])
    subgraph VPC["VPC (10.0.0.0/16) — region-wide"]
        ALB["ALB<br/>(attached to both Public Subnets, single ALB)"]
        subgraph AZa["AZ-a"]
            PubA["Public Subnet<br/>NAT GW A"]
            PriA["Private Subnet<br/>EC2-1"]
        end
        subgraph AZc["AZ-c"]
            PubC["Public Subnet<br/>NAT GW B"]
            PriC["Private Subnet<br/>EC2-2"]
        end
    end
    Internet --> ALB
    ALB --> PriA
    ALB --> PriC
    PriA -.outbound.-> PubA
    PriC -.outbound.-> PubC
```

- 1 VPC (region-wide)
- 1 ALB (attached to both Public Subnets, serving both AZs)
- 1 Public Subnet per AZ → 2 total
- 1 Private Subnet per AZ → 2 total
- 1 NAT Gateway per AZ → 2 total (for AZ failure isolation; a cheaper single-AZ NAT setup is an option — covered in Part 5)
- EC2s spread across the Private Subnets

<strong>What happens if one AZ dies</strong>: If AZ-a goes down entirely, the Public/Private Subnets and EC2s in AZ-c keep running. The ALB routes traffic only to the surviving AZ and users barely notice. That's the practical meaning of "HA via Multi-AZ."

<strong>Why you shouldn't create an ALB per AZ</strong>:

- Each ALB gives you one DNS endpoint. Two ALBs means you have to pick between them in Route 53 (weighted or failover routing policies).
- You lose the ALB's built-in cross-AZ HA — it's already Multi-AZ internally.
- Double the cost, double the operational overhead.

---

### 1.4 Glossary for This Series

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
| Cost | $0.005/hour (since Feb 2024) | Same when attached to a running EC2. <strong>Also billed while unattached</strong> |
| Use case | Temporary testing; no need for a stable IP | DNS records, IP allowlists, external integrations |
| Attaches to | Automatically to an EC2 | Manually to EC2, NAT Gateway, NLB, etc. |

> <strong>Note</strong>: Stop → start an EC2 and the Public IPv4 changes. If you pointed DNS at that IP, the connection breaks. Use an EIP when you need a stable IP. But watch out: EIPs allocated without being attached still incur charges. AWS added this penalty because IPv4 is scarce — "don't hoard addresses you don't use."

<strong>Relation to this architecture</strong>: EC2 in a Private Subnet has neither a Public IPv4 nor an EIP, because there's no external exposure in the first place. Inbound is handled by the ALB, outbound by the NAT Gateway. This is one of the reasons Private Subnets are more secure by design.

---

## 3. Do You Actually Need This Architecture? — Sizing-Based Judgment

> <strong>Note</strong>: Honestly, for small-scale systems, ALB + Private Subnet + NAT Gateway can be over-engineering. NAT Gateway alone costs $43+/month, and ALB adds $20+ — infrastructure can end up costing more than the service itself.

"Standard architecture" doesn't mean every service must adopt it. Shoving production topology into a side project wastes money, but cutting corners on a service that handles PII creates real risk. Here's where the boundary actually sits.

### 3.1 Recommended Setups by Scale

| Setup | Approx. monthly cost | Best fit |
| --- | --- | --- |
| EC2 Public Subnet + Security Group | ~$40 | Side projects, solo operators. SG-based port restrictions are enough |
| EC2 + Nginx (reverse proxy) | ~$40 | No ALB — handle routing directly with Nginx on EC2 |
| Lightsail | $10~40 | Cheapest. Flat rate, no VPC design required |
| ALB + Private EC2 + NAT Instance | ~$60 | Keep the security posture, cut NAT Gateway cost with a NAT Instance |
| ALB + Private EC2 + NAT Gateway (this series) | $100~320 | Mid-scale and up, compliance requirements, multi-person teams |

### 3.2 Aside: Nginx (Reverse Proxy) vs ALB — What's the Difference?

The table above lists "EC2 + Nginx (reverse proxy)" as an option. Understanding why requires knowing what Nginx is and where its features overlap with ALB.

<strong>Nginx is an open-source web server and reverse proxy.</strong> A reverse proxy takes client requests and forwards them to the real application (Node.js, Spring, etc.) behind it. Nginx can handle HTTPS termination, static file serving, caching, and L7 routing — all inside a single EC2.

<strong>ALB is also a reverse proxy, really</strong> — AWS's managed L7 reverse proxy and load balancer.

| Feature | Nginx (on EC2) | ALB |
| --- | --- | --- |
| L7 routing, HTTPS termination | O | O |
| Static file serving | O | X (use S3/CloudFront separately) |
| Multi-AZ availability | Dies with the EC2 | AWS handles it |
| Health checks / Auto Scaling | Manual | Automatic |
| WAF, Shield integration | Build it yourself | One click |
| Monthly cost | Included in EC2 cost | $20+ separate |
| Operational burden | You update/configure it | None (managed) |

<strong>Where their features overlap</strong>: L7 routing, HTTPS termination, and the reverse-proxying itself. So with just one EC2, you usually don't need ALB — with only one server, there's nothing to balance traffic across.

<strong>When ALB wins</strong>: 2+ EC2s with HA requirements / Auto Scaling where instance counts change dynamically / integration with AWS WAF, Shield, Cognito. Nginx can't provide distributed HA or Multi-AZ on its own because "if this EC2 dies, the service is gone."

<strong>When Nginx wins</strong>: Small-scale where one EC2 is enough / workloads that serve static files directly / aggressive cost optimization / fine-grained routing and customization (Lua scripts, custom ngx_modules).

<strong>Often used together</strong>: In production, "ALB → EC2 (Nginx) → app (Node.js/Spring)" is a common stack. ALB handles HA, health checks, and WAF; Nginx handles gzip compression, static file serving, and URL rewriting inside the EC2. They operate at different layers and are <strong>complementary rather than competing</strong>.

### 3.3 When Does a Private Subnet Become Necessary?

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

If even one row lands on the right side, it's time to consider a Private Subnet — especially <strong>compliance and data sensitivity</strong>, which push you to the mid-scale column regardless of traffic volume.

### 3.4 Aside: What Is Compliance?

The table above has a "compliance" row mentioning "financial, healthcare, PII regulations." Let's unpack what that really means.

<strong>Compliance means adhering to laws, regulations, and industry standards.</strong> For a backend engineer, the regulations that most directly shape infrastructure decisions are:

| Regulation | Applies to | Core infrastructure requirement |
| --- | --- | --- |
| PIPA (Korea) | Any business handling personal information | Access control, encryption, log retention, network separation |
| ISMS / ISMS-P (Korea) | IT companies above a size threshold | Network segmentation, access control, audit logs |
| e-Financial Supervision (Korea) | Financial services | Internal network isolation, DR, encryption key management |
| HIPAA (US) | Healthcare data | Encryption, access logs, BAA-covered services only |
| PCI DSS (global) | Credit card processing | Card number encryption, network isolation, vulnerability scans |
| GDPR (EU) | EU citizen data | Data residency, right to deletion, consent management |
| SOC 2 (global) | B2B SaaS | Access control, audit logs, change management |

<strong>How this shapes infrastructure</strong>: Almost every regulation requires <strong>network separation</strong>. "Servers processing PII or payment data must not be directly reachable from the internet" is equivalent to "you can't just drop an EC2 in a Public Subnet." A Private Subnet + ALB architecture is the <strong>standard answer</strong> that satisfies this requirement.

<strong>When juniors hit this</strong>: When the company prepares for ISMS certification, when a startup chases enterprise customers and needs SOC 2, when launching a financial or healthcare service. Once any of these kick in, the Private Subnet architecture shifts from "infra cost" to "compliance cost" — and becomes non-negotiable.

### 3.5 Aside: What Is HA (High Availability)?

The table above mentions "2+ EC2 instances" and "99.9%+ SLA." Both tie directly to HA, so a quick primer.

HA means <strong>"the service stays alive and doesn't die."</strong> ALB is one of the tools that help achieve HA.

```mermaid
flowchart TD
    HA["HA (goal)<br/>the service must always be up"]
    HA --> L1["Lever 1:<br/>Run 2+ EC2s<br/>(if one dies, others handle requests)"]
    HA --> L2["Lever 2:<br/>ALB spreads traffic<br/>(only to healthy EC2s)"]
    HA --> L3["Lever 3:<br/>Multi-AZ placement<br/>(if one AZ fails, another runs)"]
```

If you run a single EC2, the moment it dies the service is gone. With two or more, one can die and the rest keep serving — that "can survive one death" state is HA. ALB distributes traffic across them and automatically drops unhealthy instances out of rotation.

> <strong>Core decision point</strong>: Can you justify the $60–140/month that Private Subnet architecture adds? Spending $140 on a side project that runs fine on $40 is wasteful. Spending $40 on a service that handles PII just to save money is reckless. Detailed cost analysis comes in Part 5.

Concretely, you need a Private Subnet when:

- Traffic is high enough that ALB's load balancing is actually doing work
- You run 2+ EC2 instances and availability matters
- You have compliance requirements (finance, healthcare, PII)
- Team size grew and you need access control

---

## 4. PII + Public Subnet: Three Concrete Risks

Above we said "cutting costs by leaving PII-handling servers in a Public Subnet is a risk." That's not a vague warning — it breaks down into three specific risks.

### 4.1 Direct Attack Surface Exposure

- EC2 in a Public Subnet has a public IP, meaning it is <strong>directly reachable from the internet</strong>.
- A single Security Group mistake can expose database ports (3306, 5432, etc.) or SSH (22) to the entire world. These misconfigurations cause real incidents every year.
- Public IPs themselves are <strong>automatic targets for bots and scanners</strong>. Spin up an EC2 on AWS and within minutes your logs will show SSH brute-force attempts.
- If a server holding PII is directly exposed, a breach leads <strong>straight to data exfiltration</strong>. Attackers skip the usual "web tier → internal network → DB" pivot.
- With a Private Subnet architecture, all inbound traffic goes through the ALB — you get <strong>an extra defense layer</strong>. The ALB can block anomalous requests at L7, and with WAF attached you can detect and block attack patterns.

### 4.2 Compliance Violations

- Regulations like Korea's Personal Information Protection Act and ISMS-P include <strong>network isolation requirements</strong>. They mandate that "systems processing personal information must be physically or logically separated from external networks."
- During an audit, "the PII-handling server sits in a Public Subnet and is exposed via a public IP" is itself a <strong>finding</strong>. It can be classified as insufficient technical safeguards.
- After an incident, it becomes <strong>evidence that the company did not take reasonable protective measures</strong>, widening the scope of legal liability.

### 4.3 Broader Liability After an Incident

- A Private Subnet + ALB setup lets you argue <strong>"we applied the standard security architecture"</strong> — evidence that you followed AWS Well-Architected's security guidance.
- Leaving the server in a Public Subnet exposes you to the judgment that <strong>"security was neglected to cut costs."</strong>
- That judgment <strong>directly affects fines and damages awarded</strong> in court. The wider the fault, the bigger the payout.

> <strong>Bottom line</strong>: For a side project that only handles public data, Public Subnet + Security Group is fine. But the moment PII (user data, payment information, sensitive records) is involved, network-level isolation (Private Subnet) is <strong>insurance, not cost</strong>. Weigh the extra $60–100/month against potential fines and reputational damage, and the direction is obvious.

In practice, the pragmatic path is: <strong>start with Public Subnet + SG for small scale, and migrate to Private Subnet architecture when scale or data sensitivity changes</strong>. You don't need to go full-fledged from day one — but when the nature of your data shifts, don't hesitate.

---

## Recap

Key takeaways from this post:

1. <strong>The standard architecture is "ALB + Private EC2 + NAT Gateway."</strong> Inbound only via ALB, outbound only via NAT, everything else blocked.
2. <strong>Understand Public IPv4 vs EIP</strong> to see why neither is needed in this architecture — there's no external exposure at all.
3. <strong>Not every service needs this setup.</strong> A $40/month Public Subnet + SG is reasonable for small side projects. Move to Private Subnet when scale or compliance demands it.
4. <strong>HA means "2+ EC2s + ALB + Multi-AZ."</strong> This is often the practical tipping point that forces you into a Private Subnet architecture.
5. <strong>PII + Public Subnet has three concrete risks</strong>: direct attack exposure, compliance violations, and broader liability after incidents. The moment PII is involved, Private Subnet is insurance, not cost.

Part 1 had one goal — <strong>making the architecture make sense</strong>. If you now think "oh, that's why we do it this way" when you see a Private Subnet diagram, we're done here. Part 2 starts building this architecture in actual code.

In the next post — <strong>Building VPC Infrastructure with Terraform</strong> — we design the VPC CIDR, lay out 2AZ Public/Private subnets, wire up route tables, use the "SG-references-SG" pattern for Security Groups, and stand up ALB and EC2 in a single `main.tf` that comes up with one `terraform apply`.
