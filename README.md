# aws-serverless-starter-template
#### Run AWS Lambda node functions locally with a mock API Gateway and DynamoDB to test against
- `npm install serverless -g`
- `npm install`
- `./dbsetup.sh`
- `npm start` to spin up AWS Lambda and API Gateway

#### Pre-requisites
Although Serverless Framework is being used solely for local development purposes, you still need a `[default]` AWS profile in `~/.aws/credentials` in order for for you to run the app locally.

### Environmental variables

The ENV environmental variable should be one of DEV or PROD.

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