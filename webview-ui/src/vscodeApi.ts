interface VSCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare const acquireVsCodeApi: () => VSCodeApi;

class VSCodeWrapper {
  private vsCodeApi: VSCodeApi | undefined;

  constructor() {
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  public postMessage(message: any) {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      console.log("Mock postMessage:", message);
    }
  }

  public getState(): any {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    } else {
      const state = localStorage.getItem("vscodeState");
      return state ? JSON.parse(state) : undefined;
    }
  }

  public setState(state: any): void {
    if (this.vsCodeApi) {
      this.vsCodeApi.setState(state);
    } else {
      localStorage.setItem("vscodeState", JSON.stringify(state));
    }
  }
}

export const vscode = new VSCodeWrapper();
