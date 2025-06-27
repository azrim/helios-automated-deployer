const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKFLOW_LOG_PATH = path.join(__dirname, '../workflow.json');

// --- Configuration ---
const CHRONOS_CONTRACTS = [
    { logName: 'FeeCollector', requiredCount: 2 },
    { logName: 'DailyReporter', requiredCount: 2 }
];
const ALL_CONTRACT_LOG_NAMES = [
    'RandomToken', 'RandomNFT', 'AIAgent', 'HyperionQuery', 'Heartbeat',
    'FeeCollector', 'DailyReporter'
];
const LOG_RETENTION_HOURS = 48; // Keep 48 hours of history

// ** NEW FUNCTION **
// This function cleans up old records from the workflow.json file.
function cleanupOldDeployments() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) {
        return; // Nothing to clean
    }
    console.log(`\n🧹 Cleaning deployment logs older than ${LOG_RETENTION_HOURS} hours...`);
    
    const deployments = JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
    const now = new Date();
    const retentionPeriod = new Date(now.getTime() - (LOG_RETENTION_HOURS * 60 * 60 * 1000));
    
    const recentDeployments = {};
    let cleanedCount = 0;

    for (const key in deployments) {
        const dep = deployments[key];
        if (dep.timestamp && new Date(dep.timestamp) > retentionPeriod) {
            recentDeployments[key] = dep;
        } else {
            cleanedCount++;
        }
    }

    const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(recentDeployments, replacer, 2));

    if (cleanedCount > 0) {
        console.log(`   -> Removed ${cleanedCount} old deployment records.`);
    } else {
        console.log(`   -> No old records to remove.`);
    }
}


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

function getDeploymentsFromLast24Hours() {
    if (!fs.existsSync(WORKFLOW_LOG_PATH)) {
        console.log(`Workflow log not found. Starting fresh.`);
        return [];
    }
    const deployments = JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    return Object.values(deployments).filter(dep => {
        if (!dep.timestamp) return false;
        const deploymentDate = new Date(dep.timestamp);
        return deploymentDate > twentyFourHoursAgo;
    });
}

function getNextContractToDeploy() {
    const recentDeployments = getDeploymentsFromLast24Hours();
    console.log(`\nFound ${recentDeployments.length} deployments in the last 24 hours from workflow.json.`);

    for (const contract of CHRONOS_CONTRACTS) {
        const count = recentDeployments.filter(d => d.logName === contract.logName).length;
        console.log(`   - ${contract.logName} has been deployed ${count} times.`);
        if (count < contract.requiredCount) {
            console.log(`   -> Decision: Deploying mandatory contract: ${contract.logName}`);
            return contract.logName;
        }
    }

    const randomLogName = ALL_CONTRACT_LOG_NAMES[Math.floor(Math.random() * ALL_CONTRACT_LOG_NAMES.length)];
    console.log(`   -> Decision: Deploying random contract: ${randomLogName}`);
    return randomLogName;
}

function updateWorkflowLog() {
    const localLogPath = path.join(__dirname, '../deployments.json');
    if (!fs.existsSync(localLogPath)) return;

    const localLog = JSON.parse(fs.readFileSync(localLogPath, 'utf-8'));

    let workflowLog = {};
    if (fs.existsSync(WORKFLOW_LOG_PATH)) {
        workflowLog = JSON.parse(fs.readFileSync(WORKFLOW_LOG_PATH, 'utf-8'));
    }
    
    Object.assign(workflowLog, localLog);

    const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
    fs.writeFileSync(WORKFLOW_LOG_PATH, JSON.stringify(workflowLog, replacer, 2));
    console.log(`📝 Saved deployment data to workflow.json`);
}

async function main() {
    try {
        // ** Run the cleanup function at the start of every job **
        cleanupOldDeployments();

        const logNameToDeploy = getNextContractToDeploy();
        if (!logNameToDeploy) {
            console.log("No contract to deploy at this time.");
            return;
        }

        const command = `npx hardhat deploy --log-name ${logNameToDeploy} --network heliosTestnet`;
        await executeCommand(command);
        
        updateWorkflowLog();

        console.log(`\n✅ Successfully completed deployment for ${logNameToDeploy}.`);

    } catch (error) {
        console.error('\n❌ An error occurred during the scheduled deployment:', error.message);
        process.exit(1);
    }
}

main();