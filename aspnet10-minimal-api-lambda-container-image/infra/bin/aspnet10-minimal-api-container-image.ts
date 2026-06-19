#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspnet10MinimalApiContainerImageStack } from '../lib/aspnet10-minimal-api-container-image-stack';

const app = new cdk.App();
new Aspnet10MinimalApiContainerImageStack(app, 'Aspnet10MinimalApiContainerImageStack', {
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
