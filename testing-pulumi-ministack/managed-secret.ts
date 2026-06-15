import * as pulumi from "@pulumi/pulumi";
import * as crypto from "crypto";
import {
    SecretsManagerClient,
    CreateSecretCommand,
    PutSecretValueCommand,
    DeleteSecretCommand,
    DescribeSecretCommand,
} from "@aws-sdk/client-secrets-manager";

// --- Password generation ---

interface PasswordPolicy {
    length: number;
    excludeUppercase?: boolean;
    excludeLowercase?: boolean;
    excludeNumbers?: boolean;
    excludePunctuation?: boolean;
}

function generatePassword(policy: PasswordPolicy): string {
    let charset = "";
    if (!policy.excludeLowercase) charset += "abcdefghijklmnopqrstuvwxyz";
    if (!policy.excludeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (!policy.excludeNumbers) charset += "0123456789";
    if (!policy.excludePunctuation) charset += "!@#$%^&*()-_=+[]{}|;:,.<>?";

    if (charset.length === 0) {
        throw new Error("Password policy excludes all character sets");
    }

    const bytes = crypto.randomBytes(policy.length);
    return Array.from(bytes, (b) => charset[b % charset.length]).join("");
}

// --- Types ---

interface ManagedSecretInputs extends PasswordPolicy {
    name: string;
}

// --- Provider ---

function getClient(): SecretsManagerClient {
    // AWS SDK v3.362.0+ reads AWS_ENDPOINT_URL automatically.
    // Passing it explicitly also works and supports older SDK versions.
    return new SecretsManagerClient({
        endpoint: process.env.AWS_ENDPOINT_URL,
    });
}

class ManagedSecretProvider implements pulumi.dynamic.ResourceProvider {
    async create(inputs: pulumi.Inputs): Promise<pulumi.dynamic.CreateResult> {
        const props = inputs as unknown as ManagedSecretInputs;
        const password = generatePassword(props);

        const client = getClient();
        const result = await client.send(
            new CreateSecretCommand({
                Name: props.name,
                SecretString: password,
            }),
        );

        return {
            id: result.ARN!,
            outs: {
                ...props,
                arn: result.ARN!,
                versionId: result.VersionId!,
                generatedPassword: password,
            },
        };
    }

    async diff(
        id: string,
        olds: pulumi.Inputs,
        news: pulumi.Inputs,
    ): Promise<pulumi.dynamic.DiffResult> {
        const o = olds as unknown as ManagedSecretInputs;
        const n = news as unknown as ManagedSecretInputs;

        const replaces: string[] = [];

        // Secret name is immutable in AWS; changing it forces replacement.
        if (o.name !== n.name) {
            replaces.push("name");
        }

        // Password policy changes are handled by update (rotation).
        const policyChanged =
            o.length !== n.length ||
            o.excludeUppercase !== n.excludeUppercase ||
            o.excludeLowercase !== n.excludeLowercase ||
            o.excludeNumbers !== n.excludeNumbers ||
            o.excludePunctuation !== n.excludePunctuation;

        return {
            changes: replaces.length > 0 || policyChanged,
            replaces,
        };
    }

    async update(
        id: string,
        _olds: pulumi.Inputs,
        news: pulumi.Inputs,
    ): Promise<pulumi.dynamic.UpdateResult> {
        const props = news as unknown as ManagedSecretInputs;
        const password = generatePassword(props);

        const client = getClient();
        const result = await client.send(
            new PutSecretValueCommand({
                SecretId: id,
                SecretString: password,
            }),
        );

        return {
            outs: {
                ...props,
                arn: id,
                versionId: result.VersionId!,
                generatedPassword: password,
            },
        };
    }

    async delete(id: string, _props: pulumi.Inputs): Promise<void> {
        const client = getClient();
        try {
            await client.send(
                new DeleteSecretCommand({
                    SecretId: id,
                    ForceDeleteWithoutRecovery: true,
                }),
            );
        } catch (e: unknown) {
            // Idempotent: ignore if already deleted.
            if (e instanceof Error && e.name !== "ResourceNotFoundException") {
                throw e;
            }
        }
    }

    async read(id: string, props: pulumi.Inputs): Promise<pulumi.dynamic.ReadResult> {
        const client = getClient();
        const result = await client.send(
            new DescribeSecretCommand({ SecretId: id }),
        );

        return {
            id: result.ARN ?? id,
            props: { ...props, arn: result.ARN ?? id },
        };
    }
}

// --- Resource ---

export interface ManagedSecretArgs {
    name: pulumi.Input<string>;
    length?: pulumi.Input<number>;
    excludeUppercase?: pulumi.Input<boolean>;
    excludeLowercase?: pulumi.Input<boolean>;
    excludeNumbers?: pulumi.Input<boolean>;
    excludePunctuation?: pulumi.Input<boolean>;
}

export class ManagedSecret extends pulumi.dynamic.Resource {
    public readonly arn!: pulumi.Output<string>;
    public readonly versionId!: pulumi.Output<string>;
    public readonly generatedPassword!: pulumi.Output<string>;

    constructor(name: string, args: ManagedSecretArgs, opts?: pulumi.CustomResourceOptions) {
        const provider = new ManagedSecretProvider();
        super(
            provider,
            name,
            {
                // Output-only properties, populated by the provider's outs
                arn: undefined,
                versionId: undefined,
                generatedPassword: undefined,
                // Input properties with defaults
                length: 32,
                excludeUppercase: false,
                excludeLowercase: false,
                excludeNumbers: false,
                excludePunctuation: false,
                ...args,
            },
            {
                additionalSecretOutputs: ["generatedPassword"],
                ...opts,
            },
        );
    }
}
