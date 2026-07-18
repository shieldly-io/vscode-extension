// CJS copy of key logic from apps/web/src/lib/cfParser.js
// Adapted for the VS Code extension: only needs to detect if a JSON file
// contains an IAM policy, and to extract the relevant policy document.

// Identity-bearing IAM resource types the server's CF analysis inspects. Includes
// User and Group (their inline Policies are analyzed) — verified live: a User-only
// template returns findings, so the presence gate must not exclude them.
const IAM_TYPES = [
  'AWS::IAM::Role',
  'AWS::IAM::ManagedPolicy',
  'AWS::IAM::Policy',
  'AWS::IAM::User',
  'AWS::IAM::Group',
];
const CF_RESOURCE_MAP = {
  iam_identity: ['AWS::IAM::Role', 'AWS::IAM::ManagedPolicy', 'AWS::IAM::Policy'],
  cross_account: ['AWS::IAM::Role'],
  s3_bucket: ['AWS::S3::Bucket', 'AWS::S3::BucketPolicy'],
  lambda_resource: ['AWS::Lambda::Function', 'AWS::Lambda::Permission'],
  sqs_queue: ['AWS::SQS::Queue', 'AWS::SQS::QueuePolicy'],
  kms_key: ['AWS::KMS::Key'],
  sns_topic: ['AWS::SNS::Topic', 'AWS::SNS::TopicPolicy'],
};

/**
 * Detect if a parsed JSON object is a standalone IAM policy document.
 * @param {object} obj
 * @returns {boolean}
 */
function isIAMPolicy(obj) {
  return (
    obj && typeof obj === 'object' && obj.Version === '2012-10-17' && Array.isArray(obj.Statement)
  );
}

/**
 * Detect if a parsed JSON object is a CloudFormation template.
 * @param {object} obj
 * @returns {boolean}
 */
function isCFTemplate(obj) {
  return obj && typeof obj === 'object' && obj.Resources && typeof obj.Resources === 'object';
}

/**
 * Extract IAM-policy-bearing resources from a CloudFormation template.
 * @param {object} template
 * @returns {Array<{logicalId: string, type: string, policyJson: string|null}>}
 */
function extractIAMResources(template) {
  const results = [];
  for (const [logicalId, resource] of Object.entries(template.Resources || {})) {
    if (!IAM_TYPES.includes(resource.Type)) continue;
    const props = resource.Properties || {};
    let policy = null;

    if (resource.Type === 'AWS::IAM::Role') {
      policy = props.AssumeRolePolicyDocument || props.Policies || null;
    } else if (
      resource.Type === 'AWS::IAM::ManagedPolicy' ||
      resource.Type === 'AWS::IAM::Policy'
    ) {
      policy = props.PolicyDocument || null;
    } else if (resource.Type === 'AWS::IAM::User' || resource.Type === 'AWS::IAM::Group') {
      // Users/Groups carry permissions via an inline Policies array.
      policy = props.Policies || null;
    }

    results.push({
      logicalId,
      type: resource.Type,
      policyJson: policy ? JSON.stringify(policy, null, 2) : null,
    });
  }
  return results;
}

module.exports = { isIAMPolicy, isCFTemplate, extractIAMResources, CF_RESOURCE_MAP };
