import * as aws from "@pulumi/aws";
import { interpolate } from "@pulumi/pulumi";
import * as fs from "fs";

/**
 * S3 bucket to contain Docusarusus build output files
 */
const docusaurusBucket = new aws.s3.Bucket("docusaurus-3-bucket", {
    bucket: 'docusaurus-3',
});

/**
 * Origin Access Control for Cloudfront to access S3 bucket
 */
const oac = new aws.cloudfront.OriginAccessControl('docusaurus-3-cloudfront-oac', {
    originAccessControlOriginType: 's3',
    signingBehavior: 'always',
    signingProtocol: 'sigv4',
    description: 'OAC to allow Cloudfront access to S3',
    name: 'docusaurus-3-cloudfront-oac'
})

/**
 * Cloudfront Function to redirect requests to index.html
 */
const cloudfrontFunction = new aws.cloudfront.Function('docusaurus-3-redirect-to-index', {
    runtime: 'cloudfront-js-2.0',
    name: 'docusaurus-3-redirect-to-index',
    code: fs.readFileSync(`redirect-function.js`, "utf8"),
    publish: true
})

/**
 * Cloudfront distribution
 */
const distribution = new aws.cloudfront.Distribution('docusaurus-3-cloudfront-distribution', {
    enabled: true,
    restrictions: {
        geoRestriction: {
            restrictionType: 'none'
        }
    },
    origins: [
        {
            domainName: docusaurusBucket.bucketRegionalDomainName,
            originId: docusaurusBucket.id,
            originAccessControlId: oac.id,
        }
    ],
    defaultCacheBehavior: {
        targetOriginId: docusaurusBucket.id,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD", "OPTIONS"],
        forwardedValues: {
            queryString: false,
            cookies: { forward: "none" },
        },
        functionAssociations: [
            {
                eventType: 'viewer-request',
                functionArn: interpolate`${cloudfrontFunction.arn}`
            }
        ],
        minTtl: 0,
        defaultTtl: 86400,
        maxTtl: 31536000,
    },
    viewerCertificate: {
        cloudfrontDefaultCertificate: true,
    },
})

/**
 * S3 bucket policy to allow read content by Cloudfront distribution
 */
new aws.s3.BucketPolicy('docusaurus-3-bucket-policy', {
    bucket: docusaurusBucket.bucket,
    policy: {
        Version: '2008-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: aws.iam.Principals.CloudfrontPrincipal,
                Action: 's3:GetObject',
                Resource: interpolate`${docusaurusBucket.arn}/*`,
                Condition: {
                    StringEquals: {
                        'AWS:SourceArn': interpolate`${distribution.arn}`
                    }
                }
            }
        ]
    }
}, {
    /**
     * Distribution needs to be created before it can be referenced in bucket policy. Otherwise you get error below:
     * putting S3 Bucket (docusaurus-3) Policy: operation error S3: PutBucketPolicy, https response error StatusCode: 400, RequestID: , HostID: , api error MalformedPolicy: Policy has invalid resource
     */
    dependsOn: distribution
})
