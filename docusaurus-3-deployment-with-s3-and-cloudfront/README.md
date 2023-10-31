# Docusaurus 3 deployment with AWS S3 and Cloudfront

This code example for https://ahanoff.dev/blog/docusaurus-3-deployment-with-aws-s3-and-cloudfront post

## Prerequisites

 - AWS programmatic credentials
 - Pulumi CLI
 - NodeJS LTS

## Deployment

> [!Note]
> 
> Deployment steps assume that AWS programmatic credentials has been configured with appropriate IAM permission

```sh
# deploy infra
cd infra
npm install
pulumi up --stack=dev
cd ..
```

```sh
# build new docs
cd docusaurus3
npm install
npm run build
cd ..
```

> [!Warning]
> You need to replace distribution id to your own, otherwise you get the error:
> An error occurred (NoSuchDistribution) when calling the CreateInvalidation operation: The specified distribution does not exist.

```sh
# synchronize default docusaurus build output directory with S3 bucket
aws s3 sync ./docusaurus3/build s3://docusaurus-3
# create cloudfront invalidation to clear CDN cache
aws cloudfront create-invalidation --distribution-id EDFDVBD6EXAMPLE --paths '/*'
```
