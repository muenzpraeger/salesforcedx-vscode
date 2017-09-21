/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

// tslint:disable:no-unused-expression
import * as util from '@salesforce/salesforcedx-utils-vscode/out/src/test/orgUtils';
import { expect } from 'chai';
import * as path from 'path';
import { CommonActions } from '../src/areas/common';
import { createWorkspace, removeWorkspace } from '../src/helpers/workspace';
import {
  SpectronApplication,
  VSCODE_BINARY_PATH
} from '../src/spectron/application';

const TITLE = 'force:soql:query UI commands Tests';
const PROJECT_NAME = `project_${new Date().getTime()}`;

describe(TITLE, () => {
  let app: SpectronApplication;
  let common: CommonActions;

  const PROJECT_DIR = path.join(process.cwd(), PROJECT_NAME);

  let username: string;

  before(async () => {
    path.join(
      createWorkspace(path.join(process.cwd(), 'assets', 'sfdx-simple')),
      'sfdx-simple'
    );
    await util.createSFDXProject(PROJECT_NAME);
    username = await util.createScratchOrg(PROJECT_NAME);
  });

  after(async () => {
    await util.deleteScratchOrg(PROJECT_NAME, username);
    await removeWorkspace(PROJECT_DIR);
  });

  beforeEach(async () => {
    app = new SpectronApplication(VSCODE_BINARY_PATH, TITLE, 2, [PROJECT_DIR]);
    common = new CommonActions(app);

    await app.start();
    await app.wait();
  });

  afterEach(async () => {
    return await app.stop();
  });

  it('Should execute SOQL query from input box', async () => {
    // Invoke SFDX: Execute SOQL Query command by name
    await app.command('workbench.action.quickOpen');
    await common.type('>SFDX: Execute SOQL Query');
    await app.client.keys(['NULL', 'Enter', 'NULL'], false);
    await app.wait();

    const query = `SELECT Id, Name FROM Account`;

    // Enter SOQL query
    await common.type(query);
    await app.client.keys(['NULL', 'Enter', 'NULL'], false);
    await app.wait();

    const successNotification = await common.getMessageNotification();
    expect(successNotification).to.equal(
      'SFDX: Execute SOQL Query successfully ran'
    );
  });

  it('Should execute SOQL query with current selection', async () => {
    // Enter SOQL query in active editor
    const query = `SELECT Id, Name FROM Account`;
    await common.type(query);
    await app.wait();

    // Select all text in the current window
    await app.client.keys(['Meta', 'a', 'NULL'], false);

    // Invoke SFDX: Execute SOQL Query command by name
    await app.command('workbench.action.quickOpen');
    await common.type('>SFDX: Execute SOQL Query with Current Selection');
    await app.client.keys(['NULL', 'Enter', 'NULL'], false);
    await app.wait();

    const successNotification = await common.getMessageNotification();
    expect(successNotification).to.equal(
      'SFDX: Execute SOQL Query successfully ran'
    );
  });
});