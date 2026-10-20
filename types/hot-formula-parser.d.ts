declare module 'hot-formula-parser' {
  export class Parser {
    constructor();
    
    parse(expression: string): {
      result: any;
      error: string | null; 
    };
    
    setVariable(name: string, value: any): void;
    getVariable(name: string): any;
    setFunction(name: string, fn: Function): void;
  }
}