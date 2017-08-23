/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import {
  CliCommandExecutor,
  CommandExecution,
  SfdxCommandBuilder
} from '@salesforce/salesforcedx-utils-vscode/out/src/cli';
import {
  ApexBreakpointLocation,
  LineBpsInTyperef
} from '../breakpoints/lineBreakpoint';
import { CommandOutput } from '../utils/commandOutput';

export class BreakpointService {
  private static instance: BreakpointService;
  private lineNumberMapping: Map<string, LineBpsInTyperef[]> = new Map();
  private liveBreakpoints: Map<string, ApexBreakpointLocation[]> = new Map();

  public static getInstance() {
    if (!BreakpointService.instance) {
      BreakpointService.instance = new BreakpointService();
    }
    return BreakpointService.instance;
  }

  public setValidLines(
    lineNumberMapping: Map<string, LineBpsInTyperef[]>
  ): void {
    this.lineNumberMapping = lineNumberMapping;
  }

  public isApexDebuggerBreakpointId(id: string): boolean {
    return id != null && id.startsWith('07b');
  }

  public getTyperefFor(uri: string, line: number): string {
    const linesInTyperefs = this.lineNumberMapping.get(uri);
    if (linesInTyperefs) {
      for (const linesInTyperef of linesInTyperefs) {
        for (const validLine of linesInTyperef.lines) {
          if (validLine === line) {
            return linesInTyperef.typeref;
          }
        }
      }
    }
    return '';
  }

  public cacheLiveBreakpoint(
    uriArg: string,
    lineArg: number,
    breakpointIdArg: string
  ) {
    if (!this.liveBreakpoints.has(uriArg)) {
      this.liveBreakpoints.set(uriArg, []);
    }
    this.liveBreakpoints.get(uriArg)!.push(
      <ApexBreakpointLocation>{
        line: lineArg,
        breakpointId: breakpointIdArg
      }
    );
  }

  public getCachedBreakpoints(): Map<string, ApexBreakpointLocation[]> {
    return this.liveBreakpoints;
  }

  public async createLineBreakpoint(
    projectPath: string,
    sessionId: string,
    typeref: string,
    line: number
  ): Promise<CommandOutput> {
    const execution = new CliCommandExecutor(
      new SfdxCommandBuilder()
        .withArg('force:data:record:create')
        .withFlag('--sobjecttype', 'ApexDebuggerBreakpoint')
        .withFlag(
          '--values',
          `SessionId='${sessionId}' FileName='${typeref}' Line=${line} IsEnabled='true' Type='Line'`
        )
        .withArg('--usetoolingapi')
        .withArg('--json')
        .build(),
      { cwd: projectPath }
    ).execute();
    const result = await this.getIdFromCommandResult(execution);
    if (this.isApexDebuggerBreakpointId(result.getId())) {
      return Promise.resolve(result);
    } else {
      return Promise.reject(result.getStdOut());
    }
  }

  public async deleteLineBreakpoint(
    projectPath: string,
    breakpointId: string
  ): Promise<CommandOutput> {
    const execution = new CliCommandExecutor(
      new SfdxCommandBuilder()
        .withArg('force:data:record:delete')
        .withFlag('--sobjecttype', 'ApexDebuggerBreakpoint')
        .withFlag('--sobjectid', breakpointId)
        .withArg('--usetoolingapi')
        .withArg('--json')
        .build(),
      { cwd: projectPath }
    ).execute();
    const result = await this.getIdFromCommandResult(execution);
    if (this.isApexDebuggerBreakpointId(result.getId())) {
      return Promise.resolve(result);
    } else {
      return Promise.reject(result.getStdOut());
    }
  }

  public async reconcileBreakpoints(
    projectPath: string,
    sessionId: string,
    uri: string,
    clientLines?: number[]
  ): Promise<number[]> {
    const lineBpsStillEnabled: ApexBreakpointLocation[] = [];
    const lineBpsActuallyEnabled = this.liveBreakpoints.get(uri);
    if (clientLines && clientLines.length > 0 && lineBpsActuallyEnabled) {
      for (
        let clientLineIdx = 0;
        clientLineIdx < clientLines.length;
        clientLineIdx++
      ) {
        for (
          let serverBpIdx = 0;
          serverBpIdx < lineBpsActuallyEnabled.length;
          serverBpIdx++
        ) {
          if (
            clientLines[clientLineIdx] ===
            lineBpsActuallyEnabled[serverBpIdx].line
          ) {
            lineBpsStillEnabled.push(lineBpsActuallyEnabled[serverBpIdx]);
            clientLines.splice(clientLineIdx, 1);
            lineBpsActuallyEnabled.splice(serverBpIdx, 1);
          }
        }
      }
    }
    if (lineBpsActuallyEnabled && lineBpsActuallyEnabled.length > 0) {
      for (const serverBp of lineBpsActuallyEnabled) {
        await this.deleteLineBreakpoint(projectPath, serverBp.breakpointId);
      }
    }
    this.liveBreakpoints.set(uri, lineBpsStillEnabled);

    return clientLines ? Promise.resolve(clientLines) : Promise.resolve([]);
  }

  public clearSavedBreakpoints(): void {
    this.liveBreakpoints.clear();
  }

  private async getIdFromCommandResult(
    execution: CommandExecution
  ): Promise<CommandOutput> {
    const outputHolder = new CommandOutput();
    execution.stderrSubject.subscribe(data =>
      outputHolder.setStdErr(data.toString())
    );
    execution.stdoutSubject.subscribe(data =>
      outputHolder.setStdOut(data.toString())
    );

    return new Promise<
      CommandOutput
    >(
      (
        resolve: (result: CommandOutput) => void,
        reject: (reason: string) => void
      ) => {
        execution.processExitSubject.subscribe(data => {
          if (data != undefined && data.toString() === '0') {
            try {
              const respObj = JSON.parse(outputHolder.getStdOut());
              if (respObj && respObj.result && respObj.result.id) {
                outputHolder.setId(respObj.result.id);
                return resolve(outputHolder);
              } else {
                return reject(outputHolder.getStdOut());
              }
            } catch (e) {
              return reject(outputHolder.getStdOut());
            }
          } else {
            return reject(outputHolder.getStdErr());
          }
        });
      }
    );
  }
}