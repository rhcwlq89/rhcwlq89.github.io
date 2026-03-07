---
title: "Kubernetes Fundamentals: Everything You Need to Know"
description: "A comprehensive guide to Kubernetes basics - architecture, core objects, networking, deployment strategies, and essential kubectl commands"
pubDate: "2026-03-07T09:00:00+09:00"
lang: en
tags: ["Kubernetes", "DevOps", "Container", "Infrastructure"]
heroImage: "../../../assets/KubernetesBasicsGuide.png"
---

## Introduction

Kubernetes (often abbreviated as K8s) is a container orchestration tool.
You might know how to create containers with Docker, but what happens when the number of containers grows to dozens or even hundreds?

As the number of containers increases, the limitations of manual management become apparent:

- You have to manually decide which server each container should run on
- When a container dies, you have to restart it manually
- When traffic spikes, you have to manually scale up containers
- When deploying a new version, you have to replace containers one by one

Kubernetes solves these problems automatically:

- **Automatic Scheduling**: Places containers on appropriate nodes based on resource availability
- **Self-Healing**: Automatically restarts containers when they fail
- **Auto Scaling**: Dynamically adjusts the number of containers based on load
- **Load Balancing**: Distributes traffic across multiple containers
- **Rolling Updates**: Deploys new versions with zero downtime

The purpose of this article is to cover the fundamental Kubernetes concepts you need before reading the EKS + ArgoCD series.
It is intended for developers who are familiar with Docker basics but have limited K8s experience.

> This article is the **fundamentals** installment of the series.
> - **This article**: Kubernetes Fundamentals: Everything You Need to Know
> - **Part 1**: Production-Level EKS Cluster Setup Guide
> - **Part 2**: GitOps Deployment Pipeline with ArgoCD (coming soon)

---

## Architecture

A Kubernetes cluster consists of two main parts: the **Control Plane** and the **Worker Nodes**.

### Control Plane

The Control Plane acts as the brain of the cluster. It manages the overall state of the cluster and makes decisions.

| Component | Role |
|-----------|------|
| **API Server** | The entry point for all requests. Both kubectl commands and inter-component communication go through the API Server |
| **etcd** | A key-value store that holds all cluster state data. It is the cluster's "database" |
| **Scheduler** | Decides which node to place newly created Pods on, considering resource availability and constraints |
| **Controller Manager** | Continuously compares the desired state with the current state and works to reconcile them |

### Worker Nodes

Worker Nodes are the servers where containers actually run. Each Worker Node runs the following components:

| Component | Role |
|-----------|------|
| **kubelet** | An agent that manages Pod execution on the node. It receives instructions from the API Server to create/delete containers |
| **kube-proxy** | Handles network routing. Routes incoming traffic from Services to the appropriate Pods |
| **Container Runtime** | The runtime that actually executes containers. Examples include containerd and CRI-O |

### Overall Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Control Plane                         │
│                                                         │
│  ┌────────────┐  ┌────────┐  ┌───────────┐  ┌────────┐ │
│  │ API Server │  │  etcd  │  │ Scheduler │  │Controller│ │
│  │            │  │        │  │           │  │ Manager │ │
│  └─────┬──────┘  └────────┘  └───────────┘  └────────┘ │
└────────┼────────────────────────────────────────────────┘
         │
         │  kubectl, API requests
         │
┌────────┼────────────────────────────────────────────────┐
│        ▼         Worker Node 1                          │
│  ┌─────────┐  ┌────────────┐  ┌───────────────────┐    │
│  │ kubelet │  │ kube-proxy │  │ Container Runtime │    │
│  └────┬────┘  └────────────┘  └───────────────────┘    │
│       │                                                 │
│  ┌────▼────┐  ┌─────────┐  ┌─────────┐                │
│  │  Pod A  │  │  Pod B  │  │  Pod C  │                │
│  └─────────┘  └─────────┘  └─────────┘                │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│                  Worker Node 2                          │
│  ┌─────────┐  ┌────────────┐  ┌───────────────────┐    │
│  │ kubelet │  │ kube-proxy │  │ Container Runtime │    │
│  └────┬────┘  └────────────┘  └───────────────────┘    │
│       │                                                 │
│  ┌────▼────┐  ┌─────────┐                              │
│  │  Pod D  │  │  Pod E  │                              │
│  └─────────┘  └─────────┘                              │
└─────────────────────────────────────────────────────────┘
```

Here is an example of the core workflow:

1. A user runs `kubectl apply -f deployment.yaml`
2. The **API Server** receives the request and stores it in etcd
3. The **Controller Manager** detects that "the Deployment needs 3 Pods but currently has 0"
4. The **Scheduler** decides which node to place each Pod on
5. The **kubelet** on the assigned node starts the containers

---

## Core Objects

Resources managed by Kubernetes are called "objects."
Let's examine the most important objects one by one.

### Pod

A Pod is the smallest deployable unit in Kubernetes.
A single Pod contains one or more containers.
Containers within the same Pod share network and storage.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  containers:
    - name: app
      image: nginx:1.27
      ports:
        - containerPort: 80
      resources:
        requests:
          memory: "64Mi"
          cpu: "250m"
        limits:
          memory: "128Mi"
          cpu: "500m"
```

> In practice, you rarely create Pods directly.
> It is standard practice to manage Pods through a Deployment.

### ReplicaSet

A ReplicaSet ensures that a specified number of Pod replicas are always running.
If a Pod is deleted or fails, it automatically creates a new one.

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: my-app-rs
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
```

> You rarely create ReplicaSets directly either.
> Deployments automatically manage ReplicaSets for you.

### Deployment

A Deployment is the most commonly used object in practice.
It manages ReplicaSets and provides rolling update and rollback capabilities.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: NODE_ENV
              value: "production"
          resources:
            requests:
              memory: "128Mi"
              cpu: "250m"
            limits:
              memory: "256Mi"
              cpu: "500m"
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

### Relationship Between Objects

Deployment, ReplicaSet, and Pod form a hierarchical structure:

```
Deployment (my-app)
  └── ReplicaSet (my-app-7d9f8b6c4d)
        ├── Pod (my-app-7d9f8b6c4d-abc12)
        ├── Pod (my-app-7d9f8b6c4d-def34)
        └── Pod (my-app-7d9f8b6c4d-ghi56)
```

- A **Deployment** creates and manages ReplicaSets
- A **ReplicaSet** maintains the desired number of Pod replicas
- A **Pod** runs the actual containers

When you change the image version, the Deployment creates a new ReplicaSet,
gradually creates new Pods while removing old ones (rolling update).

### Namespace

A Namespace is a way to logically partition a single cluster.
You can isolate resources by team or environment.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
---
apiVersion: v1
kind: Namespace
metadata:
  name: staging
---
apiVersion: v1
kind: Namespace
metadata:
  name: development
```

```bash
# Deploy resources to a specific namespace
kubectl apply -f deployment.yaml -n production

# List Pods by namespace
kubectl get pods -n production
kubectl get pods -n staging

# List Pods across all namespaces
kubectl get pods --all-namespaces
```

Kubernetes provides the following default namespaces:

| Namespace | Purpose |
|-----------|---------|
| `default` | The default namespace used when no namespace is specified |
| `kube-system` | Where Kubernetes system components run |
| `kube-public` | Readable by all users |
| `kube-node-lease` | Contains node heartbeat-related resources |

### ConfigMap

A ConfigMap is an object that separates configuration values from code.
It allows you to externalize environment variables, configuration files, and more.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  DATABASE_HOST: "db.example.com"
  DATABASE_PORT: "5432"
  LOG_LEVEL: "info"
  config.yaml: |
    server:
      port: 8080
      timeout: 30s
    cache:
      ttl: 300
```

How to use a ConfigMap in a Pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: my-app:1.0.0
      # Inject as environment variables
      envFrom:
        - configMapRef:
            name: app-config
      # Mount as a file
      volumeMounts:
        - name: config-volume
          mountPath: /etc/config
  volumes:
    - name: config-volume
      configMap:
        name: app-config
        items:
          - key: config.yaml
            path: config.yaml
```

### Secret

A Secret is an object for managing sensitive information such as passwords and API keys.
It is similar to a ConfigMap, but the data is stored as base64-encoded values.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque
data:
  # base64-encoded values
  # echo -n 'my-password' | base64 → bXktcGFzc3dvcmQ=
  DATABASE_PASSWORD: bXktcGFzc3dvcmQ=
  API_KEY: c2VjcmV0LWFwaS1rZXk=
```

How to use a Secret in a Pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: my-app:1.0.0
      env:
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: app-secret
              key: DATABASE_PASSWORD
```

> **Important**: base64 is encoding, not encryption.
> For production environments, it is recommended to integrate with
> external secret management tools such as AWS Secrets Manager or HashiCorp Vault.

---

## Networking

### Why Services Are Needed

Each time a Pod is created, it receives a new IP address.
Since the IP changes whenever a Pod is restarted or replaced,
there needs to be a reliable way for other Pods or external clients to reach specific Pods.

A **Service** provides a stable endpoint for a set of Pods.
It uses a Label Selector to identify target Pods and automatically distributes traffic among them.

### Service Type Comparison

| Type | Access Scope | Use Case | External Exposure |
|------|-------------|----------|-------------------|
| **ClusterIP** | Internal cluster only | Inter-microservice communication | No |
| **NodePort** | Node IP + Port | Development/testing environments | Yes (ports 30000-32767) |
| **LoadBalancer** | Cloud load balancer | Production external services | Yes (creates a cloud LB) |

### ClusterIP

The default Service type, accessible only from within the cluster.
Primarily used for inter-microservice communication.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  type: ClusterIP  # Default, can be omitted
  selector:
    app: backend
  ports:
    - port: 80        # Port exposed by the Service
      targetPort: 8080 # Actual port on the Pod
```

Within the cluster, you can access it via `backend-service.default.svc.cluster.local` or
simply `backend-service` if you are in the same namespace.

### NodePort

Opens a specific port on each Worker Node to accept external traffic.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-service
spec:
  type: NodePort
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080  # Specify within 30000-32767 range (auto-assigned if omitted)
```

You can access it via `<NodeIP>:30080`.
While convenient, it is common to use a LoadBalancer or Ingress in production.

### LoadBalancer

Automatically creates an external load balancer in cloud environments.
On AWS, this creates a CLB (Classic) or NLB (Network Load Balancer).

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  type: LoadBalancer
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
```

An external IP (or DNS name) is automatically assigned to the load balancer, making it accessible from outside the cluster.

### Ingress

Ingress provides L7 (HTTP/HTTPS) level routing.
It allows you to distribute traffic to multiple services through a single load balancer.

Key features:
- **Host-based routing**: `api.example.com` -> API service, `web.example.com` -> Web service
- **Path-based routing**: `/api` -> API service, `/` -> Web service
- **TLS termination**: Handles HTTPS certificates at the Ingress level

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
spec:
  ingressClassName: alb
  rules:
    # Host-based routing
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-service
                port:
                  number: 80
  # TLS configuration
  tls:
    - hosts:
        - api.example.com
        - web.example.com
      secretName: tls-secret
```

> To use Ingress, an Ingress Controller must be installed in the cluster.
> On AWS, the AWS Load Balancer Controller is commonly used, while on-premises environments often use the Nginx Ingress Controller.

---

## Storage

Containers are ephemeral by nature. When a Pod is deleted, its internal data is lost.
To persist data, you need to use Persistent Volumes.

### PersistentVolume (PV)

A PV is a cluster-level storage resource.
It can be pre-provisioned by an administrator or dynamically created through a StorageClass.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce   # Read/write from a single node only
  persistentVolumeReclaimPolicy: Retain  # Retain data even after PVC deletion
  storageClassName: gp3
  csi:
    driver: ebs.csi.aws.com
    volumeHandle: vol-0123456789abcdef0
```

### PersistentVolumeClaim (PVC)

A PVC is how a Pod requests storage.
You specify the desired capacity and access mode, and a matching PV is bound.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: gp3
```

How to use a PVC in a Pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  containers:
    - name: app
      image: my-app:1.0.0
      volumeMounts:
        - name: data
          mountPath: /app/data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: app-data
```

### StorageClass

A StorageClass defines how PVs are dynamically provisioned when a PVC is created.
Instead of administrators manually creating PVs, storage is automatically allocated when a PVC is created.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  fsType: ext4
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
```

> On AWS EKS, you can use gp2/gp3 StorageClasses by installing the EBS CSI Driver.

---

## Deployment Strategies

### Rolling Update

This is the default deployment strategy in Kubernetes.
New version Pods are created one at a time while old version Pods are removed one at a time.

How it works:

1. New Pods are created (up to the maxSurge limit)
2. Once new Pods are in the Ready state, old Pods are removed (up to the maxUnavailable limit)
3. This process repeats until all Pods have been replaced

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # Allow up to 1 extra Pod beyond the desired count
      maxUnavailable: 0   # Always maintain the minimum replica count (zero downtime)
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:2.0.0  # Rolling update begins when the version changes
          ports:
            - containerPort: 8080
```

| Setting | Meaning |
|---------|---------|
| `maxSurge: 1` | If replicas is 3, up to 4 Pods can run simultaneously |
| `maxUnavailable: 0` | At least 3 Pods must always be in the Ready state |
| `maxSurge: 0, maxUnavailable: 1` | Terminates 1 Pod first, then creates a new one (saves resources, but briefly reduces capacity) |

To roll back if needed:

```bash
# Check rollout status
kubectl rollout status deployment/my-app

# Roll back to the previous version
kubectl rollout undo deployment/my-app

# Roll back to a specific revision
kubectl rollout undo deployment/my-app --to-revision=2

# View rollout history
kubectl rollout history deployment/my-app
```

### Helm

Helm is the package manager for Kubernetes.
Like apt (Ubuntu) or brew (macOS), it lets you install and manage complex applications in one step.

Why is it needed?

Deploying a single application requires multiple YAML files:
Deployment, Service, ConfigMap, Secret, Ingress, PVC, and more.
Managing these separately for each environment (dev/staging/prod) can result in dozens of YAML files.

Helm solves this problem:

- **Chart** = A package. A bundle of related YAML files
- **values.yaml** = Configuration values. Only the values that differ per environment are managed separately
- **Release** = An instance of a Chart installed on the cluster

```
my-app-chart/
├── Chart.yaml        # Chart metadata (name, version)
├── values.yaml       # Default configuration values
├── templates/        # YAML templates
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── configmap.yaml
└── values-prod.yaml  # Production environment values (overrides)
```

Key benefits of Helm:

- **Packaging**: Bundle multiple YAMLs into a single Chart for easier management
- **Version Control**: Manage Chart versions and roll back to previous versions
- **Environment-Specific Configuration**: Split values.yaml by environment to deploy the same Chart with different settings
- **Reusability**: Use verified Charts from public Chart repositories (Nginx, PostgreSQL, etc.)

```bash
# Add a chart repository
helm repo add bitnami https://charts.bitnami.com/bitnami

# Search for charts
helm search repo nginx

# Install a chart
helm install my-nginx bitnami/nginx -f values-prod.yaml

# List releases
helm list

# Upgrade
helm upgrade my-nginx bitnami/nginx -f values-prod.yaml

# Rollback
helm rollback my-nginx 1
```

---

## Essential kubectl Commands

kubectl is the CLI tool for interacting with a Kubernetes cluster.
Here is a summary of frequently used commands in practice.

### Listing Resources

```bash
# List Pods
kubectl get pods

# List all resources
kubectl get all

# List Pods in a specific namespace
kubectl get pods -n kube-system

# List with detailed information
kubectl get pods -o wide

# Output in YAML format
kubectl get pod my-app -o yaml

# Watch for real-time changes
kubectl get pods --watch
```

### Viewing Detailed Information

```bash
# Pod details (events, status, conditions, etc.)
kubectl describe pod my-app

# Service details
kubectl describe service my-service

# Node details
kubectl describe node <node-name>
```

`describe` is especially useful for debugging. You can check the Events section to identify the root cause of errors.

### Creating/Modifying Resources

```bash
# Create or update resources from a YAML file
kubectl apply -f deployment.yaml

# Apply all YAML files in a directory
kubectl apply -f ./k8s/

# Preview changes before applying (dry-run)
kubectl apply -f deployment.yaml --dry-run=client
```

### Deleting Resources

```bash
# Delete a specific resource
kubectl delete pod my-app

# Delete resources defined in a YAML file
kubectl delete -f deployment.yaml

# Delete all Pods in a namespace
kubectl delete pods --all -n development
```

### Viewing Logs

```bash
# View Pod logs
kubectl logs my-app

# Stream logs in real time
kubectl logs -f my-app

# View logs from a previous container (after a restart)
kubectl logs my-app --previous

# View logs from a specific container in a multi-container Pod
kubectl logs my-app -c sidecar
```

### Accessing Containers

```bash
# Open a shell in a container
kubectl exec -it my-app -- /bin/bash

# Execute a specific command
kubectl exec my-app -- cat /etc/config/app.yaml

# Access a specific container in a multi-container Pod
kubectl exec -it my-app -c sidecar -- /bin/sh
```

### Port Forwarding

```bash
# Forward local port 8080 to Pod port 80
kubectl port-forward pod/my-app 8080:80

# Port forward through a Service
kubectl port-forward service/my-service 8080:80
```

This is useful for accessing cluster-internal services from your local machine. It is commonly used during debugging and development.

### Useful Options Reference

| Option | Description | Example |
|--------|-------------|---------|
| `-n <namespace>` | Specify a namespace | `kubectl get pods -n production` |
| `-o wide` | Show additional info (IP, node, etc.) | `kubectl get pods -o wide` |
| `-o yaml` | Output in YAML format | `kubectl get pod my-app -o yaml` |
| `-o json` | Output in JSON format | `kubectl get pod my-app -o json` |
| `--watch` | Watch for real-time changes | `kubectl get pods --watch` |
| `-l <label>` | Filter by label | `kubectl get pods -l app=my-app` |
| `--all-namespaces` | All namespaces | `kubectl get pods --all-namespaces` |

---

## YAML Manifest Structure

Kubernetes resources are defined in YAML files.
Every YAML manifest has four required fields.

### Four Required Fields

```yaml
apiVersion: apps/v1        # 1. API version
kind: Deployment           # 2. Resource type
metadata:                  # 3. Metadata
  name: my-app
  namespace: production
  labels:
    app: my-app
    version: v1
spec:                      # 4. Desired state (spec)
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: my-app:1.0.0
```

| Field | Role |
|-------|------|
| **apiVersion** | The API group and version to use. Examples: `v1` (Core), `apps/v1` (Deployment, ReplicaSet), `networking.k8s.io/v1` (Ingress) |
| **kind** | The type of resource. Pod, Deployment, Service, ConfigMap, etc. |
| **metadata** | Identifying information such as name, namespace, labels, and annotations |
| **spec** | The desired state of the resource. The fields vary depending on the resource type |

### Labels and Selectors

Labels are key-value pairs attached to resources.
Selectors are mechanisms for selecting resources based on their Labels.

These two concepts are how Kubernetes objects are connected to each other.

```yaml
# Deployment: assigns labels to Pods
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  selector:
    matchLabels:
      app: my-app         # Manages Pods with this label
  template:
    metadata:
      labels:
        app: my-app       # Label assigned to Pods
        tier: backend
    spec:
      containers:
        - name: app
          image: my-app:1.0.0
          ports:
            - containerPort: 8080
---
# Service: uses selector to target Pods
apiVersion: v1
kind: Service
metadata:
  name: my-app-service
spec:
  selector:
    app: my-app            # Routes traffic to Pods with the app=my-app label
  ports:
    - port: 80
      targetPort: 8080
```

How it works:

1. The Deployment creates Pods with the `app: my-app` label
2. The Service's `selector` specifies `app: my-app`
3. The Service automatically discovers all Pods with this label and distributes traffic among them
4. Even when Pods are added or removed, the Service automatically recognizes them as long as their labels match

> You can attach multiple labels freely.
> Combining labels like `app`, `version`, `tier`, and `environment`
> enables fine-grained resource management.

---

## Conclusion

Here is a summary of what this article covered:

1. **Architecture**: The roles of the Control Plane (API Server, etcd, Scheduler, Controller Manager) and Worker Nodes (kubelet, kube-proxy, Container Runtime)
2. **Core Objects**: The Pod -> ReplicaSet -> Deployment hierarchy, Namespace, ConfigMap, and Secret
3. **Networking**: Traffic management through Services (ClusterIP, NodePort, LoadBalancer) and Ingress
4. **Storage**: Data persistence with PV, PVC, and StorageClass
5. **Deployment Strategies**: Rolling updates and package management with Helm
6. **kubectl**: Frequently used commands and options in practice
7. **YAML Manifests**: The four required fields and the Label/Selector mechanism

If you have understood these fundamental concepts, you are ready to follow along with the practical series.

**Part 1** covers how to build a production-grade AWS EKS cluster.
It walks you through getting started quickly with eksctl, transitioning to Terraform for IaC,
and configuring networking essentials like ALB, DNS, and HTTPS -- all ready to apply in practice.

**Part 2** covers building a GitOps-based deployment pipeline using ArgoCD.
It will explain how to use a Git repository as the single source of truth for automatic cluster deployments.
