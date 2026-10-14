# ASP.NET 10 Minimal API on AWS Lambda with a container image

Code for the blog post [Running ASP.NET 10 Minimal API on AWS Lambda with Container Image](https://ahanoff.dev/blog/aspnet10-minimal-api-lambda-container-image).

An ASP.NET 10 Minimal API with built-in validation, packaged as a Lambda container image for ARM64 and served through an HTTP API. The CDK app has two stacks:

| Stack | What it creates |
| --- | --- |
| `Aspnet10RepositoryStack` | The ECR repository, with immutable tags |
| `Aspnet10ApiStack` | The Lambda function, its log group and the HTTP API. Only defined when `-c imageTag=...` is passed. |

The repository is a stack of its own because the function can't be created until its image is in the repository.

## Prerequisites

- [mise](https://mise.jdx.dev/), which installs the .NET SDK and Bun from `mise.toml`
- Docker with Buildx, or Podman
- `jq`
- AWS credentials and a [bootstrapped](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) account, to deploy to AWS

```bash
mise install
cd infra && bun install
```

## Run locally

```bash
cd src/AspNet10ContainerImage
dotnet run
```

Outside Lambda, `AddAWSLambdaHosting` does nothing and the app runs on Kestrel.

## Test against MiniStack

[MiniStack](https://github.com/ministackorg/ministack) runs Lambda container images as containers, so it needs the Docker socket:

```bash
docker run -d --name ministack -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock ministackorg/ministack
scripts/test-ministack.sh
```

The script bootstraps CDK into MiniStack, deploys both stacks, builds the image for this machine's architecture and checks that the API returns `200`, `201` and `400` with the `X-Lambda-Request-Id` header. Set `DOCKER=podman` to build with Podman.

MiniStack runs the image from the local image store, so the script doesn't push. It doesn't check the function architecture against the image, or reject the image index formats that AWS Lambda rejects. Those two only show up on AWS.

## Deploy to AWS

```bash
cd infra
bunx cdk deploy Aspnet10RepositoryStack
REPOSITORY=$(aws cloudformation describe-stacks --stack-name Aspnet10RepositoryStack \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text)
TAG=$(git rev-parse --short HEAD)

aws ecr get-login-password | docker login --username AWS --password-stdin "${REPOSITORY%%/*}"
docker buildx build --platform linux/arm64 --provenance=false \
  -t "$REPOSITORY:$TAG" --push ../src/AspNet10ContainerImage

bunx cdk deploy Aspnet10ApiStack -c imageTag="$TAG"
```

- Build for one platform. Lambda doesn't run multi-architecture images.
- `--provenance=false` stops Buildx from wrapping the image in an image index with an attestation, which Lambda rejects.
- Tags are immutable, so every build needs a new tag. The commit SHA is one.
- To run on x86_64, build with `--platform linux/amd64` and deploy with `-c architecture=x86_64`. The two must match.

## Clean up

```bash
bunx cdk destroy Aspnet10ApiStack -c imageTag="$TAG"
bunx cdk destroy Aspnet10RepositoryStack
```
