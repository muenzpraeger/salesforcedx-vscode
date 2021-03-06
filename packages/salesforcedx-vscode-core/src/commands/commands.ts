/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import {
  CliCommandExecutor,
  Command
} from '@salesforce/salesforcedx-utils-vscode/out/src/cli';
import * as path from 'path';
import * as vscode from 'vscode';
import glob = require('glob');
import { channelService } from '../channels';
import { nls } from '../messages';
import { notificationService } from '../notifications';
import { isSfdxProjectOpened } from '../predicates';
import { CancellableStatusBar, taskViewService } from '../statuses';

// Precondition checking
////////////////////////
export interface PreconditionChecker {
  check(): boolean;
}

export interface PostconditionChecker<T> {
  check(
    inputs: ContinueResponse<T> | CancelResponse
  ): Promise<ContinueResponse<T> | CancelResponse>;
}

export class LightningFilePathExistsChecker
  implements PostconditionChecker<DirFileNameSelection> {
  public async check(
    inputs: ContinueResponse<DirFileNameSelection> | CancelResponse
  ): Promise<ContinueResponse<DirFileNameSelection> | CancelResponse> {
    if (inputs.type === 'CONTINUE') {
      const baseFileName = path.join(
        inputs.data.outputdir,
        inputs.data.fileName,
        inputs.data.fileName
      );
      const files = await vscode.workspace.findFiles(
        `{${baseFileName}.app,${baseFileName}.cmp,${baseFileName}.intf,${baseFileName}.evt}`
      );
      // If file does not exist then create it, otherwise prompt user to overwrite the file
      if (files.length === 0) {
        return inputs;
      } else {
        const overwrite = await notificationService.showWarningMessage(
          nls.localize('warning_prompt_lightning_bundle_overwrite'),
          nls.localize('warning_prompt_yes'),
          nls.localize('warning_prompt_no')
        );
        if (overwrite === nls.localize('warning_prompt_yes')) {
          return inputs;
        }
      }
    }
    return { type: 'CANCEL' };
  }
}

export class FilePathExistsChecker
  implements PostconditionChecker<DirFileNameSelection> {
  private fileExtension: string;

  public constructor(fileExtension: string) {
    this.fileExtension = fileExtension;
  }

  public async check(
    inputs: ContinueResponse<DirFileNameSelection> | CancelResponse
  ): Promise<ContinueResponse<DirFileNameSelection> | CancelResponse> {
    if (inputs.type === 'CONTINUE') {
      const files = await vscode.workspace.findFiles(
        path.join(
          inputs.data.outputdir,
          inputs.data.fileName + this.fileExtension
        )
      );
      // If file does not exist then create it, otherwise prompt user to overwrite the file
      if (files.length === 0) {
        return inputs;
      } else {
        const overwrite = await notificationService.showWarningMessage(
          nls.localize('warning_prompt_file_overwrite'),
          nls.localize('warning_prompt_yes'),
          nls.localize('warning_prompt_no')
        );
        if (overwrite === nls.localize('warning_prompt_yes')) {
          return inputs;
        }
      }
    }
    return { type: 'CANCEL' };
  }
}

export class EmptyPostChecker implements PostconditionChecker<any> {
  public async check(
    inputs: ContinueResponse<any> | CancelResponse
  ): Promise<ContinueResponse<any> | CancelResponse> {
    return inputs;
  }
}

export class SfdxWorkspaceChecker implements PreconditionChecker {
  public check(): boolean {
    const result = isSfdxProjectOpened.apply(vscode.workspace);
    if (!result.result) {
      notificationService.showErrorMessage(result.message);
      return false;
    }
    return true;
  }
}

// Input gathering
//////////////////
export interface ContinueResponse<T> {
  type: 'CONTINUE';
  data: T;
}

export interface CancelResponse {
  type: 'CANCEL';
}

export interface ParametersGatherer<T> {
  gather(): Promise<CancelResponse | ContinueResponse<T>>;
}

export class CompositeParametersGatherer<T> implements ParametersGatherer<T> {
  private readonly gatherers: ParametersGatherer<any>[];
  public constructor(...gatherers: ParametersGatherer<any>[]) {
    this.gatherers = gatherers;
  }
  public async gather(): Promise<CancelResponse | ContinueResponse<T>> {
    const aggregatedData: any = {};
    for (const gatherer of this.gatherers) {
      const input = await gatherer.gather();
      if (input.type === 'CONTINUE') {
        Object.keys(input.data).map(
          key => (aggregatedData[key] = input.data[key])
        );
      } else {
        return {
          type: 'CANCEL'
        };
      }
    }
    return {
      type: 'CONTINUE',
      data: aggregatedData
    };
  }
}

export class EmptyParametersGatherer implements ParametersGatherer<{}> {
  public async gather(): Promise<CancelResponse | ContinueResponse<{}>> {
    return { type: 'CONTINUE', data: {} };
  }
}

export type FileSelection = { file: string };
export class FileSelector implements ParametersGatherer<FileSelection> {
  private readonly include: string;
  private readonly exclude?: string;
  private readonly maxResults?: number;

  constructor(include: string, exclude?: string, maxResults?: number) {
    this.include = include;
    this.exclude = exclude;
    this.maxResults = maxResults;
  }

  public async gather(): Promise<
    CancelResponse | ContinueResponse<FileSelection>
  > {
    const files = await vscode.workspace.findFiles(
      this.include,
      this.exclude,
      this.maxResults
    );
    const fileItems = files.map(file => {
      return {
        label: path.basename(file.toString()),
        description: file.fsPath
      };
    });
    const selection = await vscode.window.showQuickPick(fileItems);
    return selection
      ? { type: 'CONTINUE', data: { file: selection.description.toString() } }
      : { type: 'CANCEL' };
  }
}

export type DirFileNameSelection = {
  fileName: string;
  outputdir: string;
};

export class SelectFileName
  implements ParametersGatherer<{ fileName: string }> {
  public async gather(): Promise<
    CancelResponse | ContinueResponse<{ fileName: string }>
  > {
    const fileNameInputOptions = <vscode.InputBoxOptions>{
      prompt: nls.localize('parameter_gatherer_enter_file_name')
    };
    const fileName = await vscode.window.showInputBox(fileNameInputOptions);
    return fileName
      ? { type: 'CONTINUE', data: { fileName } }
      : { type: 'CANCEL' };
  }
}

export abstract class SelectDirPath
  implements ParametersGatherer<{ outputdir: string }> {
  private explorerDir: string | undefined;
  private globKeyWord: string | undefined;

  public constructor(explorerDir?: vscode.Uri, globKeyWord?: string) {
    this.explorerDir = explorerDir ? explorerDir.fsPath : explorerDir;
    this.globKeyWord = globKeyWord;
  }

  public abstract globDirs(srcPath: string, priorityKeyword?: string): string[];

  public async gather(): Promise<
    CancelResponse | ContinueResponse<{ outputdir: string }>
  > {
    const rootPath = vscode.workspace.rootPath;
    let outputdir;
    if (rootPath) {
      outputdir = this.explorerDir
        ? path.relative(rootPath, this.explorerDir)
        : await vscode.window.showQuickPick(
            this.globDirs(rootPath, this.globKeyWord),
            <vscode.QuickPickOptions>{
              placeHolder: nls.localize('parameter_gatherer_enter_dir_name')
            }
          );
    }
    return outputdir
      ? { type: 'CONTINUE', data: { outputdir } }
      : { type: 'CANCEL' };
  }
}
export class SelectPrioritizedDirPath extends SelectDirPath {
  public globDirs(srcPath: string, priorityKeyword?: string): string[] {
    const unprioritizedRelDirs = new glob.GlobSync(
      path.join(srcPath, '**/')
    ).found.map(value => {
      let relativePath = path.relative(srcPath, path.join(value, '/'));
      relativePath = path.join(relativePath, '');
      return relativePath;
    });
    if (priorityKeyword) {
      const notPrioritized: string[] = [];
      const prioritized = unprioritizedRelDirs.filter(dir => {
        if (dir.includes(priorityKeyword)) {
          return true;
        } else {
          notPrioritized.push(dir);
        }
      });
      return prioritized.concat(notPrioritized);
    }
    return unprioritizedRelDirs;
  }
}

export class SelectStrictDirPath extends SelectDirPath {
  public globDirs(srcPath: string, priorityKeyword?: string): string[] {
    const globPattern = priorityKeyword
      ? path.join(srcPath, '**/', priorityKeyword + '/')
      : path.join(srcPath, '**/');
    const relativeDirs = new glob.GlobSync(globPattern).found.map(value => {
      let relativePath = path.relative(srcPath, path.join(value, '/'));
      relativePath = path.join(relativePath, '');
      return relativePath;
    });
    return relativeDirs;
  }
}

// Command Execution
////////////////////
export interface CommandletExecutor<T> {
  execute(response: ContinueResponse<T>): void;
}

// Common

export abstract class SfdxCommandletExecutor<T>
  implements CommandletExecutor<T> {
  public execute(response: ContinueResponse<T>): void {
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const cancellationToken = cancellationTokenSource.token;

    const execution = new CliCommandExecutor(this.build(response.data), {
      cwd: vscode.workspace.rootPath
    }).execute(cancellationToken);

    channelService.streamCommandOutput(execution);
    channelService.showChannelOutput();
    notificationService.reportCommandExecutionStatus(
      execution,
      cancellationToken
    );
    CancellableStatusBar.show(execution, cancellationTokenSource);
    taskViewService.addCommandExecution(execution, cancellationTokenSource);
  }

  public abstract build(data: T): Command;
}

export class SfdxCommandlet<T> {
  private readonly prechecker: PreconditionChecker;
  private readonly postchecker: PostconditionChecker<T>;
  private readonly gatherer: ParametersGatherer<T>;
  private readonly executor: CommandletExecutor<T>;

  constructor(
    checker: PreconditionChecker,
    gatherer: ParametersGatherer<T>,
    executor: CommandletExecutor<T>,
    postchecker = new EmptyPostChecker()
  ) {
    this.prechecker = checker;
    this.gatherer = gatherer;
    this.executor = executor;
    this.postchecker = postchecker;
  }

  public async run(): Promise<void> {
    if (this.prechecker.check()) {
      let inputs = await this.gatherer.gather();
      inputs = await this.postchecker.check(inputs);
      switch (inputs.type) {
        case 'CONTINUE':
          return this.executor.execute(inputs);
        case 'CANCEL':
          return;
      }
    }
  }
}
