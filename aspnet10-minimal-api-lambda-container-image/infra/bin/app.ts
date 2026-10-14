import * as cdk from 'aws-cdk-lib';
import { Architecture } from 'aws-cdk-lib/aws-lambda';
import { RepositoryStack } from '../lib/repository-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const { repository } = new RepositoryStack(app, 'Aspnet10RepositoryStack');

// The API stack needs an image that's already in the repository:
//   cdk deploy Aspnet10ApiStack -c imageTag=<tag> [-c architecture=x86_64]
const imageTag: string | undefined = app.node.tryGetContext('imageTag');
if (imageTag) {
  new ApiStack(app, 'Aspnet10ApiStack', {
    repository,
    imageTag,
    architecture: app.node.tryGetContext('architecture') === 'x86_64' ? Architecture.X86_64 : Architecture.ARM_64,
  });
}
