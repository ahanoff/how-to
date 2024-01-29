import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Code, Function, Handler, Runtime } from 'aws-cdk-lib/aws-lambda';
import { HttpApi, PayloadFormatVersion } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'

export class Aspnet8MinimalApiContainerImageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * ECR Registry for asp.net 8 minimal api container image
     */
    const ecrRepository = new Repository(this, 'aspnet8-minimal-api-container-image', {
      imageTagMutability: TagMutability.IMMUTABLE,
      repositoryName: 'aspnet8-minimal-api-container-image',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    /**
     * IAM Role for lambda
     */
    const lambdaContainerImageRole = new Role(this, 'aspnet8-minimal-api-container-image-lambda-role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
      roleName: 'aspnet8-minimal-api-container-image-function-role',
    })

    /**
     * Lambda function created from ECR image: see `runtime: Runtime.FROM_IMAGE`, `code: Code.fromEcrImage`, and `handler: Handler.FROM_IMAGE`
     */
    const lambda = new Function(this, 'aspnet8-minimal-api-container-image-lambda', {
      code: Code.fromEcrImage(ecrRepository, {
        tagOrDigest: 'latest',
      }),
      runtime: Runtime.FROM_IMAGE,
      role: lambdaContainerImageRole,
      architecture: Architecture.X86_64,
      functionName: 'aspnet8-minimal-api-container-image-lambda',
      memorySize: 1024,
      handler: Handler.FROM_IMAGE
    })

    /**
     * HTTP API gateway
     */
    const api = new HttpApi(this, 'aspnet8-minimal-api-container-image-lambda-http-api', {
      apiName: 'aspnet8-minimal-api-container-image-lambda-http-api',
      createDefaultStage: true,
      defaultIntegration: new HttpLambdaIntegration('aspnet8-minimal-api-container-image-lambda-integration', lambda, {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0
      })
    })
  }
}
