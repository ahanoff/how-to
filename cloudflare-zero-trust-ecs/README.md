# Cloudflare Zero Trust on ECS in place of an EC2 bastion

Sample codebase accompanying the blog post [Replacing EC2 bastions with Cloudflare Zero Trust on ECS](https://ahanoff.dev/blog/replacing-ec2-bastions-with-cloudflare-zero-trust-on-ecs).

A Pulumi program that runs `cloudflared` as a single ARM64 Fargate task in an existing VPC, and lets chosen users reach one database port through the Cloudflare One Client. No inbound rules, no public IP, no instance to patch.

| Resource | Purpose |
| --- | --- |
| Cloudflare Tunnel and a route for the VPC CIDR | Tells Cloudflare which private addresses sit behind the tunnel |
| SSM `SecureString` parameter | Holds the tunnel token, injected into the task as `TUNNEL_TOKEN` |
| ECS cluster, task definition and service | Runs `cloudflared`, with `cloudflared tunnel ready` as the health check |
| Security group | Outbound only: UDP and TCP `7844` to Cloudflare, TCP `443`, and `databasePort` inside the VPC |
| Two Gateway network policies | Allow `allowedGroups` and `allowedEmails` to `databasePort`, block the rest of the VPC |
| Ingress rule on the database security group | Only with `databaseSecurityGroupId` |
| Gateway proxy settings and default device profile | Only with `manageDeviceSettings` |
| Resolver policy for a private Route 53 zone | Only with `privateDomain` |

## Prerequisites

- [mise](https://mise.jdx.dev/), which installs Bun and the Pulumi CLI from `mise.toml`
- AWS credentials, and a VPC with private subnets that route to a NAT Gateway
- A Cloudflare account with a Zero Trust organization, an identity provider, and device enrollment rules that let your users enroll the [Cloudflare One Client](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/)
- A Cloudflare API token with the **Account > Cloudflare Tunnel > Edit** and **Account > Zero Trust > Edit** permissions

## Quick start

```bash
mise install
bun install
pulumi stack init dev
pulumi config set aws:region eu-west-1
pulumi config set --secret cloudflare:apiToken        # prompts for the token
pulumi config set cloudflareAccountId 0123456789abcdef0123456789abcdef
pulumi config set vpcId vpc-...
pulumi config set --path 'subnetIds[0]' subnet-...
pulumi config set --path 'subnetIds[1]' subnet-...
pulumi config set --path 'allowedGroups[0]' platform
pulumi config set databaseSecurityGroupId sg-...
pulumi up
```

`CLOUDFLARE_API_TOKEN` in the environment works instead of `cloudflare:apiToken`.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `cloudflareAccountId` | | Cloudflare account ID |
| `vpcId` | | The VPC to reach. Its CIDR becomes the tunnel route. |
| `subnetIds` | | Private subnets for the task, with a route to a NAT Gateway |
| `databasePort` | `5432` | The one port allowed users can reach |
| `databaseSecurityGroupId` | | When set, lets `cloudflared` into this security group on `databasePort` |
| `allowedGroups` | `[]` | Identity provider groups allowed in. Needs group claims or SCIM. |
| `allowedEmails` | `[]` | Users allowed in, for identity providers that don't send groups |
| `cloudflaredImage` | `cloudflare/cloudflared:2026.10.0` | Bump it to roll out a new version |
| `manageDeviceSettings` | `false` | See [Account-wide settings](#account-wide-settings) |
| `privateDomain` | | See [Private DNS](#private-dns) |

Set at least one of `allowedGroups` and `allowedEmails`. The program refuses to run without them, because the block policy would deny everyone.

## Account-wide settings

Two settings the tunnel needs apply to the whole Cloudflare account, not just this stack:

- **The Gateway proxy for TCP and UDP.** Without it, the client doesn't send traffic to the tunnel.
- **Split Tunnels.** By default the client excludes `10.0.0.0/8` and the other RFC 1918 ranges, so traffic to the VPC never reaches Cloudflare.

`manageDeviceSettings: true` turns on the proxy and puts the default device profile in Include mode with only the VPC CIDR. That replaces the profile's list from the dashboard, so only use it if the account doesn't use the client for anything else. Otherwise, [turn on the proxy](https://developers.cloudflare.com/cloudflare-one/traffic-controls/proxy/) and [add the VPC CIDR to your Split Tunnels](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/split-tunnels/) yourself.

Both are singletons in the account. After `pulumi destroy`, check them in the dashboard.

## Private DNS

RDS endpoints resolve to private IPs through public DNS, so they work without this. For a private Route 53 hosted zone:

```bash
pulumi config set privateDomain internal.example.com
```

The stack adds a resolver policy that sends queries for the zone through the tunnel to the VPC resolver at the VPC CIDR base plus two, and a network policy that lets those queries past the catch-all block. It needs the UDP proxy on.

## Connect

With the Cloudflare One Client enrolled and connected:

```bash
psql "host=mydb.abc123xyz.eu-west-1.rds.amazonaws.com user=app dbname=mydb sslmode=verify-full sslrootcert=global-bundle.pem"
```

`global-bundle.pem` is the [RDS CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem).

If the connection hangs, check that the connector is up:

```bash
aws logs tail "$(pulumi stack output logGroupName)" --follow
```

Look for `Registered tunnel connection`. Then check the Gateway network logs in the Cloudflare dashboard for a block.

## Rotate the token

1. Rotate the token on the tunnel in the Cloudflare dashboard.
2. `pulumi up` reads the new token and updates the parameter.
3. ECS injects secrets only when a task starts, so start a new one:

```bash
aws ecs update-service --cluster "$(pulumi stack output clusterName)" \
  --service "$(pulumi stack output serviceName)" --force-new-deployment
```

## Cost

About $7.20 a month for the Fargate task (0.25 vCPU, 0.5 GB, ARM64, `us-east-1`), plus NAT Gateway data processing for the tunnel traffic. The Cloudflare [Zero Trust free plan](https://www.cloudflare.com/plans/zero-trust-services/) covers up to 50 users.

## Clean up

```bash
pulumi destroy
```
