MINISTACK_ENV  = AWS_ENDPOINT_URL=http://localhost:4566 \
                 AWS_ACCESS_KEY_ID=test \
                 AWS_SECRET_ACCESS_KEY=test \
                 AWS_DEFAULT_REGION=us-east-1 \
                 PULUMI_CONFIG_PASSPHRASE=test-passphrase \
                 PULUMI_BACKEND_URL=file://./.pulumi-state

.PHONY: init local-preview local-up local-destroy reset

init:
	$(MINISTACK_ENV) pulumi stack select local --create

local-preview:
	$(MINISTACK_ENV) pulumi preview

local-up:
	$(MINISTACK_ENV) pulumi up

local-destroy:
	$(MINISTACK_ENV) pulumi destroy

reset:
	curl -X POST http://localhost:4566/_ministack/reset
