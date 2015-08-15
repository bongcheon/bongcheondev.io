import push from 'git-push';
import path from 'path';
import deploy from 'pm2-deploy';
import { execSync } from 'child_process';

/**
 * Push built directory to remote repository and launch app on remote server
 */
export default async () => {

  function run (cmd) {
    return execSync(cmd).toString();
  }

  const deployEnvPrefix = process.env.DEPLOY_PREFIX || '';

  function getEnv (key, defaultVal) {
    if (deployEnvPrefix) { key = deployEnvPrefix + '_' + key; }
    const val = process.env[key] || '';
    if (!val && defaultVal === undefined) {
      throw new Error(`missing env: $${key}`);
    }
    return val || defaultVal;
  }

  var appName = getEnv('DEPLOY_APP_NAME');

  const deployConf = {
    user: getEnv('DEPLOY_USER'),
    host: getEnv('DEPLOY_HOST'),
    port: getEnv('DEPLOY_PORT', '22'),
    ref: 'origin/master',
    repo: getEnv('DEPLOY_REMOTE'),
    path: getEnv('DEPLOY_APP_DIR', `~/apps/${appName}`),
    'post-deploy' : `npm install --production && pm2 startOrRestart app.js --name ${appName}`
  };

  // Check if local git repo is synchronized
  if (run('git diff') !== '') {
    throw new Error('Need to commit changed files');
  }

  const localRev = run('git rev-parse @');
  const remoteRev = run('git rev-parse @{u}');

  if (localRev !== remoteRev) {

    const baseRev = run('git merge-base @ @{u}');

    if (localRev === baseRev) {
      throw new Error('Need to run \'git pull\'');
    } else if (remoteRev === baseRev) {
      throw new Error('Need to run \'git push\'');
    } else {
      throw new Error(`Invalid revisions \
                      (local=${localRev}, remote=${remoteRev}, base=${baseRev})`);
    }
  }

  // Build
  await require('./build')();

  try {

    // Push built directory to remote repository
    await new Promise((resolve, reject) => {
      console.log(`push built files to ${deployConf.repo}`);
      push('./build', deployConf.repo, err => {
        console.log('push!');
        console.log(err);
        err ? reject(err) : resolve();
      });
    });
  } catch (err) {

    // TODO: Currently error occurs when built file directory is synchronized to remote repo
    if (err !== 'Failed to push the contents.') {
      throw err;
    }
  }

  // Ensure app directory on server is set up
  console.log('Ensure all remote servers are set up...');

  const checkSetupCmd = `ssh -o "StrictHostKeyChecking no" \
  -p ${deployConf.port} ${deployConf.user}@${deployConf.host} \
  "[ -d ${deployConf.path}/current ] || echo setup"`;

  const needToSetup = run(checkSetupCmd).indexOf('setup') !== -1;
  if (needToSetup) {
    console.log(`Set up app on remote location: \
                ${deployConf.user}@${deployConf.host}:${deployConf.path}`);

    await new Promise((resolve, reject) => {
      deploy.deployForEnv({
        target: deployConf
      }, 'target', ['setup'], err => err ? reject(err) : resolve());
    });
  }

  // Now deploy
  console.log('Deploy app to remote servers...');

  await new Promise((resolve, reject) => {
    deploy.deployForEnv({
      target: deployConf
    }, 'target', [], err => err ? reject(err) : resolve());
  });

};
