import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IRepository } from 'aws-cdk-lib/aws-ecr';
import { Architecture, DockerImageCode, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export interface ApiStackProps extends cdk.StackProps {
  repository: IRepository;
  imageTag: string;
  // Must match the --platform the image was built for
  architecture: Architecture;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const fn = new DockerImageFunction(this, 'Function', {
      functionName: 'aspnet10-minimal-api-container-image-lambda',
      code: DockerImageCode.fromEcr(props.repository, { tagOrDigest: props.imageTag }),
      architecture: props.architecture,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(29),
      logGroup: new LogGroup(this, 'Logs', {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const api = new HttpApi(this, 'HttpApi', {
      apiName: 'aspnet10-minimal-api-container-image-http-api',
      defaultIntegration: new HttpLambdaIntegration('Integration', fn),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
