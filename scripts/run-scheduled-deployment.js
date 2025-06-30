const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { request } = require('undici');
const hre = require("hardhat");
const { generateVerificationFiles } = require('./prepare-verification.js');

// --- Paths and Config ---
const WORKFLOW_LOG_PATH = path.join(__dirname, '../workflow.json');
const LOCAL_DEPLOYMENT_LOG_PATH = path.join(__dirname, '../deployments.json');
const CONFIG_PATH = path.join(__dirname, '../deployment-config-template.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const CHRONOS_ENABLED_CONTRACTS = config.contracts
    .filter(c => c.interactions && c.interactions.some(i => i.type === 'chronos'))
    .map(c => c.logName);
const ALL_CONTRACT_LOG_NAMES = config.contracts.map(c => c.logName);

// --- Constants ---
const LOG_RETENTION_HOURS = 48;
const CHRONOS_MANDATORY_INTERVAL_HOURS = 12;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const [owner, repo] = (GITHUB_REPOSITORY || '').split('/');
const API_URL = 'https://api.github.com';


// =============================================================================
// HELPER FUNCTIONS (No changes needed here)
// =============================================================================

function executeCommand(command) {
    return new Promise((resolve, reject) => {
        console.log(`\n> Executing: ${command}\n`);
        const childProcess = exec(command);
        childProcess.stdout.pipe(process.stdout);
        childProcess.stderr.pipe(process.stderr);
        childProcess.on('close', (code) => {
            if (code !== 0) reject(new Error(`Command failed with exit code ${code}`));
            else resolve();
        });
    });
}

function getFullDeploymentLog() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

function cleanupOldDeployments() {
    console.log(`\n🧹 Cleaning deployment logs older than ${LOG_RETENTION_HOURS} hours...`);
    const deployments = getFullDeploymentLog();
    const now = new Date();
    const retentionPeriod = new Date(now.getTime() - (LOG_RETENTION_HOURS * 60 * 60 * 1000));
    const recentDeployments = deployments.filter(dep => dep.timestamp && new Date(dep.timestamp) > retentionPeriod);
    const cleanedCount = deployments.length - recentDeployments.length;
    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(recentDeployments, null, 2));
    console.log(cleanedCount > 0 ? `   -> Removed ${cleanedCount} old deployment records.` : `   -> No old records to remove.`);
}

function getNextContractToDeploy() {
    const allDeployments = getFullDeploymentLog();
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (CHRONOS_MANDATORY_INTERVAL_HOURS * 60 * 60 * 1000));
    const lastChronosDeployment = allDeployments
        .filter(dep => CHRONOS_ENABLED_CONTRACTS.includes(dep.logName) && dep.timestamp)
        .reduce((latest, current) => new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest, { timestamp: '1970-01-01T00:00:00.000Z' });
    const lastChronosDeploymentTime = new Date(lastChronosDeployment.timestamp);

    console.log(`\nLast Chronos-type deployment was at: ${lastChronosDeploymentTime.toLocaleString()}`);
    console.log(`12 hours ago was: ${twelveHoursAgo.toLocaleString()}`);

    if (lastChronosDeploymentTime < twelveHoursAgo) {
        console.log(`   -> It has been more than ${CHRONOS_MANDATORY_INTERVAL_HOURS} hours. A Chronos deployment is mandatory.`);
        const contract = CHRONOS_ENABLED_CONTRACTS[Math.floor(Math.random() * CHRONOS_ENABLED_CONTRACTS.length)];
        console.log(`   -> Decision: Deploying mandatory Chronos contract: ${contract}`);
        return contract;
    }

    console.log(`   -> Chronos requirement is met. Deploying a random contract.`);
    const randomContract = ALL_CONTRACT_LOG_NAMES[Math.floor(Math.random() * ALL_CONTRACT_LOG_NAMES.length)];
    console.log(`   -> Decision: ${randomContract}`);
    return randomContract;
}

// =============================================================================
// GITHUB RELEASE FUNCTIONS (Moved from create-release.js)
// =============================================================================

async function createRelease(tagName, releaseName, body) {
    console.log(`Creating release '${releaseName}' with tag '${tagName}'...`);
    const { body: responseBody, statusCode } = await request(`${API_URL}/repos/${owner}/${repo}/releases`, {
        method: 'POST',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Helios-Deployer-Release-Script' },
        body: JSON.stringify({ tag_name: tagName, name: releaseName, body: body, draft: false, prerelease: false })
    });

    if (statusCode !== 201) {
        throw new Error(`Failed to create GitHub release. Status code: ${statusCode}. Response: ${await responseBody.text()}`);
    }
    console.log('✅ Release created successfully.');
    return responseBody.json();
}

async function uploadReleaseAsset(release, assetPath) {
    const assetName = path.basename(assetPath);
    const assetSize = fs.statSync(assetPath).size;
    const fileStream = fs.createReadStream(assetPath);
    console.log(`Uploading asset '${assetName}' to release '${release.name}'...`);
    const { statusCode, body } = await request(`${release.upload_url.split('{')[0]}?name=${assetName}`, {
        method: 'POST',
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/octet-stream', 'Content-Length': assetSize, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Helios-Deployer-Release-Script' },
        body: fileStream
    });

    if (statusCode !== 201) {
        throw new Error(`Failed to upload asset. Status code: ${statusCode}. Response: ${await body.text()}`);
    }
    console.log(`✅ Asset '${assetName}' uploaded successfully.`);
}

async function orchestrateReleaseProcess() {
    console.log("\n🚀 Starting GitHub release process...");
    if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
        console.warn("⚠️ GITHUB_TOKEN or GITHUB_REPOSITORY not set. Skipping release creation.");
        return;
    }

    const newDeployments = JSON.parse(fs.readFileSync(LOCAL_DEPLOYMENT_LOG_PATH, 'utf-8'));
    if (!Array.isArray(newDeployments) || newDeployments.length === 0) {
        console.log("No new deployments found. Nothing to release.");
        return;
    }

    const deployment = newDeployments[0];
    const { standardInputPath } = await generateVerificationFiles(deployment);
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
    
    const release = await createRelease(tagName, releaseName, releaseBody.trim());
    await uploadReleaseAsset(release, standardInputPath);
    console.log("✅ GitHub release process complete.");
}

// =============================================================================
// MAIN EXECUTION LOGIC
// =============================================================================

function updateAndClearLocalLog() {
    if (!fs.existsSync(LOCAL_DEPLOYMENT_LOG_PATH)) return;
    const newDeployments = JSON.parse(fs.readFileSync(LOCAL_DEPLOYMENT_LOG_PATH, 'utf-8'));
    if (!Array.isArray(newDeployments) || newDeployments.length === 0) return;
    
    let workflowLog = getFullDeploymentLog();
    const updatedLog = workflowLog.concat(newDeployments);
    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(updatedLog, null, 2));
    console.log(`\n📝 Appended ${newDeployments.length} new deployment(s) to workflow.json`);

    fs.writeFileSync(LOCAL_DEPLOYMENT_LOG_PATH, JSON.stringify([], null, 2));
    console.log(`   -> Cleared local deployments.json for next run.`);
}

async function main() {
    try {
        cleanupOldDeployments();
        const logNameToDeploy = getNextContractToDeploy();
        if (!logNameToDeploy) {
            console.log("No contract to deploy at this time.");
            return;
        }

        const command = `npx hardhat deploy --log-name ${logNameToDeploy} --network heliosTestnet`;
        await executeCommand(command);
        
        // Create the release BEFORE clearing the log file.
        await orchestrateReleaseProcess();

        // Now, update the main workflow log and clear the local one.
        updateAndClearLocalLog();

        console.log(`\n✅ Successfully completed deployment for ${logNameToDeploy}.`);

    } catch (error) {
        console.error('\n❌ An error occurred during the scheduled deployment:', error.message);
        process.exit(1);
    }
}

main();