# aws-serverless-starter-template

### Node JS 20

Use [Node Version Manager](https://npm.github.io/installation-setup-docs/installing/using-a-node-version-manager.html) (nvm) to use right Node Version. Specified in `.nvmrc`.
- `nvm use`

#### Run AWS Lambda node functions locally with a mock API Gateway and DynamoDB to test against
- `npm install serverless -g`
- `npm install`
- `./dbsetup.sh`
- `npm start` to spin up AWS Lambda and API Gateway

#### Troubleshooting
If getting errors downloading DynamoDB, download directly from:

https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html

#### Pre-requisites
Although Serverless Framework is being used solely for local development purposes, you still need a `[default]` AWS profile in `~/.aws/credentials` in order for for you to run the app locally.

### Environmental variables

The ENV environmental variable should be one of DEV or PROD.

USE_SECRETS_MANAGER=false
TOKEN_SERVICE_ARN=rsp-token-decrypt-arn
SNSTOPICARN=snsTopicArn
SITERESOURCE=siteResource
PAYMENTURL=paymenturl
PAYMENTS_BATCH_FETCH_ARN=rsp-payments-dev-arn
ENV=development
DYNAMODB_PENALTY_GROUP_TABLE=penaltyGroups
DYNAMODB_PENALTY_DOC_TABLE=penaltyDocuments
BUCKETNAME=bucketName
TOKEN_SERVICE_URL=tokenservice
AWS_ACCESS_KEY_ID=access_key_id
AWS_SECRET_ACCESS_KEY=secret_access_key
AWS_DEFAULT_REGION=eu-west-1

### Authorisation

The API is protected by a really basic mechanism in DEV mode.
When you are sending an API request, send the header

```
"Authorization": "allow"
```
### Git Hooks

Please set up the following prepush git hook in .git/hooks/pre-push

```
#!/bin/sh
npm run prepush && git log -p | scanrepo
```

#### Security

Please install and run the following securiy programs as part of your testing process:

https://github.com/awslabs/git-secrets

- After installing, do a one-time set up with `git secrets --register-aws`. Run with `git secrets --scan`.

https://github.com/UKHomeOffice/repo-security-scanner

- After installing, run with `git log -p | scanrepo`.

These will be run as part of prepush so please make sure you set up the git hook above so you don't accidentally introduce any new security vulnerabilities.

### Building

To build for deployment to AWS.

- `npm run package`

This uses aws-sam-plugin and webpack to build each Lambda into it's own archive zip ready to upload to s3 or Lambda.
