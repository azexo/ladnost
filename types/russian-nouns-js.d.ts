// russian-nouns-js.d.ts
declare module 'russian-nouns-js' {
  export enum Gender {
    MASCULINE = 'MASCULINE',
    FEMININE = 'FEMININE',
    NEUTER = 'NEUTER'
  }

  export enum Case {
    NOM = 'NOM',
    GEN = 'GEN',
    DAT = 'DAT',
    ACC = 'ACC',
    INS = 'INS',
    PREP = 'PREP',
    LOC = 'LOC'
  }

  export interface NounOptions {
    text: string;
    gender?: Gender;
    indeclinable?: boolean;
    pluraleTantum?: boolean;
  }

  export class Lemma {
    static create(options: NounOptions): any;
  }

  export class Engine {
    decline(options: NounOptions | any, caseType: Case | number, pluralForm?: string): string[];
    pluralize(options: any): string[];
  }

  export const CASES: Case[];
}