import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';

// Deployed on its own first, so the repository exists before an image is pushed to it.
export class RepositoryStack extends cdk.Stack {
  readonly repository: Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.repository = new Repository(this, 'Repository', {
      repositoryName: 'aspnet10-minimal-api-container-image',
      // Every build gets a new tag, so a deployed tag always means the same image
      imageTagMutability: TagMutability.IMMUTABLE,
      lifecycleRules: [{ maxImageCount: 10 }],
      // Sample only: deleting the stack deletes the images
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    new cdk.CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri });
  }
}
