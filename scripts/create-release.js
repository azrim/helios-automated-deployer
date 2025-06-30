const fs = require('fs');
const path = require('path');
const { request } = require('undici');
const hre = require("hardhat");
const { generateVerificationFiles } = require('./prepare-verification.js');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.error("GITHUB_TOKEN and GITHUB_REPOSITORY env variables are required.");
    process.exit(1);
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const API_URL = 'https://api.github.com';

/**
 * Creates a new GitHub release.
 * @param {string} tagName - The name of the tag for the release.
 * @param {string} releaseName - The title of the release.
 * @param {string} body - The markdown body of the release.
 * @returns {Promise<object>} The release data from GitHub.
 */
async function createRelease(tagName, releaseName, body) {
    console.log(`Creating release '${releaseName}' with tag '${tagName}'...`);

    const { body: responseBody, statusCode } = await request(`${API_URL}/repos/${owner}/${repo}/releases`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Helios-Deployer-Release-Script'
        },
        body: JSON.stringify({
            tag_name: tagName,
            name: releaseName,
            body: body,
            draft: false,
            prerelease: false
        })
    });

    if (statusCode !== 201) {
        const errorData = await responseBody.json();
        console.error('Error creating release:', JSON.stringify(errorData, null, 2));
        throw new Error(`Failed to create GitHub release. Status code: ${statusCode}`);
    }

    console.log('✅ Release created successfully.');
    return responseBody.json();
}

/**
 * Uploads a file as an asset to a GitHub release.
 * @param {object} release - The release object from GitHub.
 * @param {string} assetPath - The local path to the file to upload.
 */
async function uploadReleaseAsset(release, assetPath) {
    const assetName = path.basename(assetPath);
    const assetSize = fs.statSync(assetPath).size;
    const fileStream = fs.createReadStream(assetPath);

    console.log(`Uploading asset '${assetName}' to release '${release.name}'...`);

    const { statusCode, body } = await request(`${release.upload_url.split('{')[0]}?name=${assetName}`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': assetSize,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Helios-Deployer-Release-Script'
        },
        body: fileStream
    });

    if (statusCode !== 201) {
        const errorData = await body.json();
        console.error('Error uploading asset:', JSON.stringify(errorData, null, 2));
        throw new Error(`Failed to upload asset. Status code: ${statusCode}`);
    }

    console.log(`✅ Asset '${assetName}' uploaded successfully.`);
}

/**
 * The main function to orchestrate the release process.
 */
async function main() {
    console.log("🚀 Starting GitHub release process...");
    
    // The deployments.json now holds the single, most recent deployment from the last run
    const deploymentsPath = path.join(__dirname, '../deployments.json');
    if (!fs.existsSync(deploymentsPath)) {
        console.log("No deployments.json file found. Nothing to release.");
        return;
    }
    
    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
    if (!Array.isArray(deployments) || deployments.length === 0) {
        console.log("No deployments found in log. Nothing to release.");
        return;
    }

    // Process the first (and only) deployment in the file
    const deployment = deployments[0];
    
    // 1. Generate verification files
    const { standardInputPath } = await generateVerificationFiles(deployment);

    // 2. Prepare release details
    const now = new Date();
    const tagName = `${deployment.logName}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${deployment.blockNumber}`;
    const releaseName = `Deployment: ${deployment.key}`;
    
    const releaseBody = `
## 🚀 Automated Deployment: ${deployment.key}

A new contract has been automatically deployed to the Helios Testnet.

### Deployment Details
- **Contract Name**: \`${deployment.key}\`
- **Address**: \`${deployment.address}\`
- **Transaction Hash**: \`${deployment.tx}\`
- **Block Number**: \`${deployment.blockNumber}\`
- **Timestamp**: \`${deployment.timestamp}\`
- **Explorer Link**: [View on Helios Explorer](${deployment.explorer})

### Verification Files
The attached \`${path.basename(standardInputPath)}\` file can be used for contract verification on the explorer via the "Standard-JSON-Input" method.
    `;

    // 3. Create release and upload asset
    const release = await createRelease(tagName, releaseName, releaseBody.trim());
    await uploadReleaseAsset(release, standardInputPath);

    console.log("\n✅ GitHub release process completed successfully!");
}

main().catch(error => {
    console.error(`\n❌ An error occurred during the release process:`, error.message);
    process.exit(1);
});