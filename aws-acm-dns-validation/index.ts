import * as aws from "@pulumi/aws";

/**
 * AWS Route53 hosted zone for DNS management delegation
 */
const zone = new aws.route53.Zone('howto.ahanoff.dev', {
    name: 'howto.ahanoff.dev'
})

/**
 * AWS ACM wildcard certificate that also validates apex domain
 * 
 */
const cert = new aws.acm.Certificate('howto.ahanoff.dev-cert', {
    domainName: '*.howto.ahanoff.dev',
    subjectAlternativeNames: [
        'howto.ahanoff.dev'
    ],
    validationMethod: 'DNS'
})

/**
 * https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore#_uniqWith
 * @param arr sequence of elements that are not unique
 * @param fn comparator
 * @returns 
 */
const uniqWith = (arr: any[], fn: (arg0: any, arg1: any) => any) => arr.filter((element, index) => arr.findIndex((step) => fn(element, step)) === index);

/**
 * Worry-free AWS ACM DNS validation for any certificate
 */
cert.domainValidationOptions.apply(validationOptions => {
    // filter out duplicate validation options based on record type, name and value
    uniqWith(validationOptions, (x: aws.types.output.acm.CertificateDomainValidationOption, y: aws.types.output.acm.CertificateDomainValidationOption) => {
        return x.resourceRecordType === y.resourceRecordType && x.resourceRecordValue === y.resourceRecordValue && x.resourceRecordName === y.resourceRecordName
    })
    // map validation options to Route53 record
    .map((validationOption, index) => {
        return new aws.route53.Record(`howto.ahanoff.dev-cert-validation-record-${index}`, {
            type: validationOption.resourceRecordType,
            ttl: 60,
            zoneId: zone.zoneId,
            name: validationOption.resourceRecordName,
            records: [
                validationOption.resourceRecordValue
            ]
        })
    })
    // for each record request DSN validation
    .forEach((certValidationRecord, index) => {
        new aws.acm.CertificateValidation(`howto.ahanoff.dev-cert-dns-validation-${index}`, {
            certificateArn: cert.arn,
            validationRecordFqdns: [ certValidationRecord.fqdn ]    
        })
    })
})
