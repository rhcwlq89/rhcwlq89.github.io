---
title: "Building a GitOps Pipeline with ArgoCD on EKS"
description: "A guide to installing ArgoCD on EKS and building a complete GitOps CI/CD pipeline with GitHub Actions"
pubDate: "2026-03-07T11:00:00+09:00"
lang: en
tags: ["AWS", "EKS", "ArgoCD", "GitOps", "CI/CD", "DevOps", "Kubernetes"]
heroImage: "../../../assets/EksArgoCdGitopsGuide.png"
---

## Introduction

When deploying applications to a Kubernetes cluster,
the most common approach is to run `kubectl apply -f deployment.yaml` directly.
It is simple at first, but as the team grows and environments multiply, problems emerge:

- There is no way to track who deployed what and when
- Different local kubectl contexts lead to accidental deployments to the wrong cluster
- Rolling back means finding the previous YAML and re-applying it manually
- Managing cluster access credentials (kubeconfig) in CI/CD pipelines becomes a security burden

**GitOps** is an operational model that solves these problems at a fundamental level.
The core principle is simple: **use a Git repository as the Single Source of Truth.**

The state declared in Git = the state that should actually exist in the cluster.
Automatically keeping these two in sync at all times -- that is the entirety of GitOps.

### Manual Deployment vs GitOps

| Aspect | Manual Deployment | GitOps |
|--------|-------------------|--------|
| Deployment method | Run `kubectl apply` manually | Auto-sync on Git push |
| Change tracking | No way to know who did what | Full audit trail via Git commit history |
| Rollback | Find the previous YAML and re-apply | A single `git revert` does the job |
| Access control | Grant kubectl access to multiple people | Only manage Git repository permissions |
| Environment consistency | Manual process can cause drift | Git is the truth, so always consistent |

### Why ArgoCD

ArgoCD and Flux are the two most popular tools for implementing GitOps.
This guide uses ArgoCD. Here is why:

- **Web UI Dashboard**: Visually monitor deployment status. Flux is CLI-centric
- **Multi-cluster support**: A single ArgoCD instance can manage multiple clusters
- **Community activity**: A CNCF Graduated project with an overwhelming number of GitHub stars and contributors
- **Abundant learning resources**: Well-documented with extensive community materials

> This post is **Part 2** of the series.
> It assumes you already have an EKS cluster built by following [Part 1 (Production-Level EKS Cluster Setup Guide)](/blog/en/eks-production-setup-guide).
> In particular, the AWS Load Balancer Controller must be installed for exposing the ArgoCD dashboard externally.

---

## Installing ArgoCD

### 1. Create the argocd namespace

```bash
kubectl create namespace argocd
```

### 2. Install ArgoCD with Helm

Using a Helm chart makes it easy to manage configuration through a values file.

```bash
# Add the ArgoCD Helm repository
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
```

Create an `argocd-values.yaml` file:

```yaml
# argocd-values.yaml
server:
  # Enable insecure mode since we will expose via Ingress
  # (TLS termination is handled at the ALB)
  extraArgs:
    - --insecure

  ingress:
    enabled: true
    ingressClassName: alb
    annotations:
      alb.ingress.kubernetes.io/scheme: internet-facing
      alb.ingress.kubernetes.io/target-type: ip
      alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS": 443}]'
      alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:ap-northeast-2:ACCOUNT_ID:certificate/CERTIFICATE_ID
      alb.ingress.kubernetes.io/ssl-redirect: "443"
      alb.ingress.kubernetes.io/healthcheck-path: /healthz
    hosts:
      - argocd.example.com
    paths:
      - /
    pathType: Prefix

  # Resource limits
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

# Redis HA is recommended for production, but disabled initially
redis-ha:
  enabled: false

# Controller resource settings
controller:
  resources:
    requests:
      cpu: 250m
      memory: 256Mi
    limits:
      cpu: "1"
      memory: 1Gi

# Repo-server resource settings
repoServer:
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

> **Note**: Replace `certificate-arn` with your ACM certificate ARN.
> The AWS Load Balancer Controller set up in Part 1 reads these annotations and automatically creates the ALB.

Install with Helm:

```bash
helm install argocd argo/argo-cd \
  --namespace argocd \
  --values argocd-values.yaml \
  --version 7.7.12
```

Verify the installation:

```bash
kubectl get pods -n argocd
```

Once all Pods are in Running status, the installation is complete:

```
NAME                                               READY   STATUS    RESTARTS   AGE
argocd-application-controller-0                     1/1     Running   0          2m
argocd-dex-server-xxx-xxx                           1/1     Running   0          2m
argocd-redis-xxx-xxx                                1/1     Running   0          2m
argocd-repo-server-xxx-xxx                          1/1     Running   0          2m
argocd-server-xxx-xxx                               1/1     Running   0          2m
```

### 3. Retrieve and change the initial admin password

ArgoCD automatically generates an initial password for the admin account during installation.
Retrieve it with the following command:

```bash
# Retrieve the initial password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

For security, make sure to change the password:

```bash
# Change the password using the argocd CLI
argocd account update-password \
  --current-password <initial_password> \
  --new-password <new_password>
```

After changing, delete the initial password Secret:

```bash
kubectl -n argocd delete secret argocd-initial-admin-secret
```

### 4. Install the argocd CLI and log in

```bash
# macOS
brew install argocd

# Linux
curl -sSL -o argocd-linux-amd64 \
  https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd
rm argocd-linux-amd64

# Verify installation
argocd version --client
```

If you have set up Ingress, log in using your domain:

```bash
argocd login argocd.example.com --grpc-web
# Username: admin
# Password: <your_new_password>
```

If you want to test without Ingress, you can use port forwarding:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
argocd login localhost:8080 --insecure
```

---

## Deploying Your First App

### Git Repository Structure

In GitOps, it is common practice to separate the application source code repository from the Kubernetes manifest repository.
This is known as the **Config Repository** pattern.

```
# Manifest repository structure
k8s-manifests/
├── apps/
│   └── my-app/
│       ├── deployment.yaml
│       ├── service.yaml
│       └── ingress.yaml
└── README.md
```

Here is a simple example set of manifests:

```yaml
# apps/my-app/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: my-app
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
---
# apps/my-app/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: default
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
```

### Writing the ArgoCD Application CRD

To manage an app with ArgoCD, you need to create an `Application` resource.
This CRD (Custom Resource Definition) defines "which path from which Git repo to deploy to which cluster."

```yaml
# argocd-apps/my-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default

  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: apps/my-app

  destination:
    server: https://kubernetes.default.svc
    namespace: default

  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### Understanding Sync Policies

ArgoCD sync policies are built around three core concepts:

| Policy | Description | When to use |
|--------|-------------|-------------|
| **Manual Sync** | Requires the user to explicitly click the Sync button | Production environments where review before deployment is needed |
| **Auto Sync** | Automatically deploys when Git changes are detected | Dev/staging environments, or when you fully trust GitOps |
| **Self-Heal** | Automatically reverts to the Git state even if someone modifies things directly via kubectl | When you want the cluster state to always match Git |
| **Prune** | Automatically deletes resources from the cluster when they are removed from Git | When you want automated resource cleanup |

> **Caution**: `prune: true` means that deleting a YAML file from Git will also delete the actual resource from the cluster.
> It is recommended to start with `prune: false` and enable it once you are comfortable with the workflow.

### Creating and syncing an app via the argocd CLI

You can also create an app using the CLI instead of a YAML file:

```bash
# Create the app
argocd app create my-app \
  --repo https://github.com/your-org/k8s-manifests.git \
  --path apps/my-app \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace default \
  --sync-policy automated \
  --auto-prune \
  --self-heal

# Check app status
argocd app get my-app

# Manual sync (if Auto Sync is not configured)
argocd app sync my-app

# List all apps
argocd app list
```

### Checking deployment status in the dashboard

Open your browser and navigate to `https://argocd.example.com` to access the dashboard.
The dashboard provides visual insight into:

- **Sync Status**: Whether the Git and cluster states match (Synced / OutOfSync)
- **Health Status**: Whether deployed resources are healthy (Healthy / Degraded / Progressing)
- **Resource Tree**: A tree view showing the Deployment -> ReplicaSet -> Pod hierarchy
- **Diff View**: Differences between Git and the cluster

---

## Managing Helm Charts

In practice, Helm charts are used far more often than plain Kubernetes manifests.
ArgoCD has native support for Helm charts.

### How to deploy Helm-based apps with ArgoCD

There are two approaches: deploying directly from an external Helm repository,
or including the Helm chart in your Git repository.

**Option 1: Deploy directly from an external Helm repository**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nginx-ingress
  namespace: argocd
spec:
  project: default
  source:
    chart: ingress-nginx
    repoURL: https://kubernetes.github.io/ingress-nginx
    targetRevision: 4.11.3
    helm:
      values: |
        controller:
          replicaCount: 2
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
  destination:
    server: https://kubernetes.default.svc
    namespace: ingress-nginx
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
```

**Option 2: Deploy a Helm chart from your Git repository**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: charts/my-app
    helm:
      valueFiles:
        - values-prod.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: default
```

### Values file separation strategy

By splitting values files per environment, you can manage multiple environments with a single Helm chart:

```
charts/my-app/
├── Chart.yaml
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
├── values.yaml          # Defaults (shared settings)
├── values-dev.yaml      # Dev environment overrides
├── values-staging.yaml  # Staging environment overrides
└── values-prod.yaml     # Production environment overrides
```

### Per-environment values override examples

```yaml
# values.yaml (defaults)
replicaCount: 1
image:
  repository: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app
  tag: latest
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 200m
    memory: 256Mi
ingress:
  enabled: false
```

```yaml
# values-dev.yaml
replicaCount: 1
image:
  tag: dev-latest
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 100m
    memory: 128Mi
```

```yaml
# values-staging.yaml
replicaCount: 2
image:
  tag: staging-latest
ingress:
  enabled: true
  host: staging.example.com
```

```yaml
# values-prod.yaml
replicaCount: 3
image:
  tag: v1.2.3
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: "1"
    memory: 1Gi
ingress:
  enabled: true
  host: app.example.com
```

### Specifying Helm values in an ArgoCD Application

You can also combine multiple values files:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: charts/my-app
    helm:
      valueFiles:
        - values.yaml
        - values-prod.yaml
      # You can also override individual parameters
      parameters:
        - name: image.tag
          value: v1.2.4
  destination:
    server: https://kubernetes.default.svc
    namespace: production
```

> **Tip**: Values specified via `parameters` take precedence over values files.
> This is useful when you want to dynamically change only the image tag from a CI/CD pipeline.

---

## App of Apps Pattern

### The concept

In a microservices architecture, you may need to manage dozens of services, each as its own ArgoCD Application.
Creating each one manually becomes difficult to manage.

The **App of Apps** pattern is a structure where a parent (root) Application manages child Applications.
You create just one root Application, and ArgoCD automatically creates the child Applications defined within it.

```
Root Application (apps)
├── Application: frontend
├── Application: backend-api
├── Application: backend-worker
├── Application: redis
└── Application: monitoring
```

### Directory structure

```
k8s-manifests/
├── argocd-apps/           # Path watched by the Root Application
│   ├── frontend.yaml      # Child Application definitions
│   ├── backend-api.yaml
│   ├── backend-worker.yaml
│   ├── redis.yaml
│   └── monitoring.yaml
├── apps/                  # Actual Kubernetes manifests
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── ingress.yaml
│   ├── backend-api/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   ├── backend-worker/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   └── redis/
│       ├── deployment.yaml
│       └── service.yaml
└── monitoring/
    ├── prometheus/
    └── grafana/
```

### Root Application YAML

```yaml
# root-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: apps
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: argocd-apps  # Directory containing child Application YAMLs
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd  # Application resources are created in the argocd namespace
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Child Application YAML

```yaml
# argocd-apps/frontend.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: frontend
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: apps/frontend
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

```yaml
# argocd-apps/backend-api.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: backend-api
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/k8s-manifests.git
    targetRevision: main
    path: apps/backend-api
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Usage in microservices

The key advantage of this pattern is that **adding a new service is as simple as adding a single YAML file to Git**.

1. Add a new Application YAML to the `argocd-apps/` directory
2. Add the corresponding service manifests to the `apps/` directory
3. Push to Git
4. The root Application automatically creates the new child Application, which in turn deploys the service

No manual action is required in the ArgoCD dashboard at all.

---

## Multi-Environment Configuration

### Introducing ApplicationSet

The App of Apps pattern is useful, but it leads to copy-pasting nearly identical Application YAMLs for each environment (dev/staging/prod).
**ApplicationSet** is an ArgoCD feature designed to eliminate this repetition.

A single ApplicationSet definition can automatically generate multiple Applications.
It works through a combination of templates and Generators.

### Generator types

| Generator | Description | Use case |
|-----------|-------------|----------|
| **List** | Generates from an explicit list of values | When the list of environments is fixed |
| **Git Directory** | Auto-generates from the directory structure of a Git repo | When you want automatic detection upon adding a directory |
| **Git File** | Generates from config files in a Git repo | When defining environments via JSON/YAML files |
| **Cluster** | Generates from the list of registered clusters | Multi-cluster deployments |
| **Matrix** | Combines two Generators | When you need environment x service combinations |

### Per-environment directory structure

```
k8s-manifests/
├── envs/
│   ├── dev/
│   │   ├── my-app/
│   │   │   ├── deployment.yaml
│   │   │   └── service.yaml
│   │   └── another-app/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   ├── staging/
│   │   ├── my-app/
│   │   │   ├── deployment.yaml
│   │   │   └── service.yaml
│   │   └── another-app/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   └── prod/
│       ├── my-app/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       └── another-app/
│           ├── deployment.yaml
│           └── service.yaml
└── applicationsets/
    └── multi-env.yaml
```

### Git Directory Generator example

```yaml
# applicationsets/multi-env.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: multi-env-apps
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - git:
        repoURL: https://github.com/your-org/k8s-manifests.git
        revision: main
        directories:
          - path: "envs/*/*"  # envs/dev/my-app, envs/prod/my-app, etc.
  template:
    metadata:
      # Extract environment name and app name from the path
      name: "{{ index .path.segments 1 }}-{{ index .path.segments 2 }}"
    spec:
      project: default
      source:
        repoURL: https://github.com/your-org/k8s-manifests.git
        targetRevision: main
        path: "{{ .path.path }}"
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{ index .path.segments 1 }}"  # Use environment name as namespace
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

This single ApplicationSet automatically generates an Application for every directory combination under `envs/`.

For example, the following Applications would be created:
- `dev-my-app` (envs/dev/my-app)
- `dev-another-app` (envs/dev/another-app)
- `staging-my-app` (envs/staging/my-app)
- `prod-my-app` (envs/prod/my-app)

To add a new environment or service, just create the directory and drop in the manifests.

### List Generator example

When environments are fixed and each needs to be deployed to a different cluster, the List Generator is a good fit:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-app-envs
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - list:
        elements:
          - env: dev
            cluster: https://kubernetes.default.svc
            namespace: dev
            values_file: values-dev.yaml
          - env: staging
            cluster: https://kubernetes.default.svc
            namespace: staging
            values_file: values-staging.yaml
          - env: prod
            cluster: https://prod-cluster-api.example.com
            namespace: production
            values_file: values-prod.yaml
  template:
    metadata:
      name: "my-app-{{ .env }}"
    spec:
      project: default
      source:
        repoURL: https://github.com/your-org/k8s-manifests.git
        targetRevision: main
        path: charts/my-app
        helm:
          valueFiles:
            - "{{ .values_file }}"
      destination:
        server: "{{ .cluster }}"
        namespace: "{{ .namespace }}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

---

## The Complete CI/CD Pipeline

The most important principle in GitOps is **separating CI and CD**.

- **CI (Continuous Integration)**: Build code, run tests, build images, and push to a registry
- **CD (Continuous Deployment)**: Sync the Git repository state to the cluster

In traditional CI/CD, the CI pipeline directly runs `kubectl apply`.
In GitOps, the CI pipeline **only updates the image tag in the manifest repository**, and ArgoCD handles the CD.

### End-to-end flow

```
1. Developer pushes application source code
2. GitHub Actions is triggered
3. Tests run
4. Docker image is built
5. Image is pushed to ECR
6. Image tag is updated in the manifest repository (Git push)
7. ArgoCD detects the change -> auto-deploys
```

### Full GitHub Actions workflow example

```yaml
# .github/workflows/ci.yaml
name: CI Pipeline

on:
  push:
    branches: [main]

env:
  AWS_REGION: ap-northeast-2
  ECR_REPOSITORY: my-app
  MANIFEST_REPO: your-org/k8s-manifests

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # For OIDC token issuance
      contents: read

    steps:
      # 1. Checkout source code
      - name: Checkout source code
        uses: actions/checkout@v4

      # 2. AWS authentication (OIDC recommended)
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-role
          aws-region: ${{ env.AWS_REGION }}

      # 3. ECR login
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      # 4. Generate image tag (using commit SHA)
      - name: Set image tag
        id: tag
        run: echo "IMAGE_TAG=${GITHUB_SHA::8}" >> $GITHUB_OUTPUT

      # 5. Build and push the Docker image
      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ steps.tag.outputs.IMAGE_TAG }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

      # 6. Update the image tag in the manifest repository
      - name: Update manifest repository
        env:
          IMAGE_TAG: ${{ steps.tag.outputs.IMAGE_TAG }}
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        run: |
          # Clone the manifest repository
          git clone https://x-access-token:${{ secrets.MANIFEST_REPO_TOKEN }}@github.com/${{ env.MANIFEST_REPO }}.git
          cd k8s-manifests

          # Update image tag using kustomize
          cd apps/my-app
          kustomize edit set image $ECR_REGISTRY/$ECR_REPOSITORY=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

          # Alternatively, use yq
          # yq eval ".spec.template.spec.containers[0].image = \"$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG\"" \
          #   -i deployment.yaml

          # Commit and push changes
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .
          git commit -m "chore: update my-app image to $IMAGE_TAG"
          git push
```

> **Key point**: The CI pipeline does not need any access to the cluster.
> No `kubectl`, no `kubeconfig`.
> All CI does is build the image and update the manifest repository.
> The actual deployment is performed by ArgoCD running inside the cluster, using a pull-based approach.

### Managing image tags with kustomize

Using kustomize in the manifest repository keeps image tag management clean:

```yaml
# apps/my-app/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
images:
  - name: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app
    newTag: abc12345  # CI updates only this part
```

ArgoCD automatically detects kustomize. No additional configuration is needed.

### ArgoCD Image Updater (alternative)

Instead of having CI directly update the manifest repository,
you can use **ArgoCD Image Updater** to automatically detect new image tags in ECR and deploy them.

```bash
# Install ArgoCD Image Updater
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/stable/manifests/install.yaml
```

Add annotations to the Application:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    argocd-image-updater.argoproj.io/image-list: >
      my-app=123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/my-app
    argocd-image-updater.argoproj.io/my-app.update-strategy: semver
    argocd-image-updater.argoproj.io/write-back-method: git
spec:
  # ... rest of configuration
```

> Image Updater is convenient, but the downside is that it fills the manifest repository's Git commit history with auto-generated commits.
> Choose the approach that fits your team's conventions.

---

## Operational Tips

### Rollback methods

There are three ways to roll back with ArgoCD:

**1. Git revert (recommended)**

This approach best aligns with the GitOps philosophy.
Revert the problematic commit in the manifest repository, and ArgoCD automatically syncs to the previous state.

```bash
cd k8s-manifests
git revert HEAD
git push
# ArgoCD automatically deploys the previous state
```

**2. ArgoCD CLI**

```bash
# Check deployment history
argocd app history my-app

# Roll back to a specific revision
argocd app rollback my-app <REVISION_NUMBER>
```

**3. ArgoCD UI**

In the dashboard, click the app -> History and Rollback -> select the desired revision -> click the Rollback button.

> **Caution**: Rolling back via CLI or UI creates a state mismatch with Git.
> If Auto Sync is enabled, it will soon re-sync to the latest Git state.
> Therefore, CLI/UI rollbacks should be used as a temporary measure in emergencies,
> and the permanent fix must always go through Git.

### Slack notification setup (ArgoCD Notifications)

With ArgoCD Notifications, you can receive deployment success/failure alerts in Slack.

```yaml
# argocd-notifications-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  service.slack: |
    token: $slack-token

  template.app-sync-succeeded: |
    slack:
      attachments: |
        [{
          "color": "#18be52",
          "title": "{{ .app.metadata.name }} deployment succeeded",
          "text": "Revision: {{ .app.status.sync.revision }}",
          "fields": [{
            "title": "Environment",
            "value": "{{ .app.spec.destination.namespace }}",
            "short": true
          }]
        }]

  template.app-sync-failed: |
    slack:
      attachments: |
        [{
          "color": "#E96D76",
          "title": "{{ .app.metadata.name }} deployment failed",
          "text": "An error occurred during sync. Check the ArgoCD dashboard.",
          "fields": [{
            "title": "Environment",
            "value": "{{ .app.spec.destination.namespace }}",
            "short": true
          }]
        }]

  trigger.on-sync-succeeded: |
    - when: app.status.operationState.phase in ['Succeeded']
      send: [app-sync-succeeded]

  trigger.on-sync-failed: |
    - when: app.status.operationState.phase in ['Error', 'Failed']
      send: [app-sync-failed]
```

Store the Slack token as a Secret:

```bash
kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=slack-token=xoxb-your-slack-bot-token
```

Enable notifications on the Application:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.slack: "#deployments"
    notifications.argoproj.io/subscribe.on-sync-failed.slack: "#deployments"
```

### Customizing Health Checks

ArgoCD automatically determines the status of Kubernetes resources by default.
However, when using CRDs (Custom Resource Definitions) or when you need custom health criteria, you can configure custom Health Checks.

Define them as Lua scripts in the `argocd-cm` ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  # Custom Health Check example: Job is Healthy only when in Complete status
  resource.customizations.health.batch_Job: |
    hs = {}
    if obj.status ~= nil then
      if obj.status.succeeded ~= nil and obj.status.succeeded > 0 then
        hs.status = "Healthy"
        hs.message = "Job completed successfully"
      elseif obj.status.failed ~= nil and obj.status.failed > 0 then
        hs.status = "Degraded"
        hs.message = "Job failed"
      else
        hs.status = "Progressing"
        hs.message = "Job is running"
      end
    end
    return hs
```

### RBAC configuration (per-project access control)

As the team grows, having everyone with admin privileges becomes risky.
ArgoCD RBAC lets you separate permissions by project.

First, create an ArgoCD Project:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: team-frontend
  namespace: argocd
spec:
  description: "Frontend team project"
  # Allowed source repositories
  sourceRepos:
    - https://github.com/your-org/frontend-manifests.git
  # Allowed deployment targets
  destinations:
    - namespace: frontend-*
      server: https://kubernetes.default.svc
  # Allowed cluster-scoped resource kinds
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  # Allowed namespace-scoped resource kinds
  namespaceResourceWhitelist:
    - group: apps
      kind: Deployment
    - group: ""
      kind: Service
    - group: networking.k8s.io
      kind: Ingress
```

Set role-based policies in the `argocd-rbac-cm` ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  policy.csv: |
    # Frontend team: can only manage apps in the team-frontend project
    p, role:frontend-team, applications, get, team-frontend/*, allow
    p, role:frontend-team, applications, sync, team-frontend/*, allow
    p, role:frontend-team, applications, override, team-frontend/*, allow
    p, role:frontend-team, logs, get, team-frontend/*, allow

    # Backend team: can only manage apps in the team-backend project
    p, role:backend-team, applications, get, team-backend/*, allow
    p, role:backend-team, applications, sync, team-backend/*, allow

    # Read-only role: can only view all apps
    p, role:readonly, applications, get, */*, allow
    p, role:readonly, logs, get, */*, allow

    # Map SSO groups to roles
    g, frontend-devs, role:frontend-team
    g, backend-devs, role:backend-team
    g, viewers, role:readonly

  policy.default: role:readonly
```

> **Tip**: Setting `policy.default: role:readonly` means that users without an explicitly assigned role
> will only have read-only permissions. As a security best practice, keep default permissions to a minimum.

---

## Conclusion

Here is a summary of what this guide covered:

1. **GitOps concepts**: An operational model that uses Git as the Single Source of Truth
2. **ArgoCD installation**: Installing on EKS with Helm and exposing the dashboard via ALB Ingress
3. **First app deployment**: Writing the Application CRD, understanding sync policies (Auto/Manual, Self-Heal, Prune)
4. **Helm chart management**: Per-environment values file separation, specifying Helm parameters in ArgoCD
5. **App of Apps pattern**: A parent Application that automatically manages child Applications
6. **ApplicationSet**: Automated multi-environment configuration using Generators
7. **CI/CD pipeline**: GitHub Actions builds the image and only updates the manifest repository; ArgoCD handles deployment
8. **Operational tips**: Rollback, Slack notifications, Health Checks, RBAC configuration

The greatest advantage of GitOps is that **deployments are possible without direct cluster access**.
Developers just push code to Git,
and operators can determine the exact current state of the cluster by looking at the Git history alone.

If you built your EKS cluster in [Part 1 (Production-Level EKS Cluster Setup Guide)](/blog/en/eks-production-setup-guide)
and set up the ArgoCD-based GitOps pipeline in this Part 2,
you now have a production-grade Kubernetes operational environment.
