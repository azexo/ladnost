// types/custom.d.ts

declare module 'petrovich' {
  export type Gender = 'male' | 'female' | 'androgynous';
  export type Case = 'nominative' | 'genitive' | 'dative' | 'accusative' | 'instrumental' | 'prepositional';
  export type NameType = 'first' | 'last' | 'middle';

  export interface Person {
    gender?: Gender;
    first?: string;
    last?: string;
    middle?: string;
  }

  export interface PetrovichInstance {
    (person: Person, caseType: Case): Person;
    male: Record<NameType, Record<Case, (name: string) => string>>;
    female: Record<NameType, Record<Case, (name: string) => string>>;
    androgynous: Record<NameType, Record<Case, (name: string) => string>>;
    detect_gender: (middleName: string) => Gender;
  }

  const petrovich: PetrovichInstance;
  export default petrovich;
}

declare module 'number-to-words-ru' {
  export interface ConvertOptions {
    currency?: string;
    declension?: 'nominative' | 'genitive' | 'dative' | 'accusative' | 'instrumental' | 'prepositional';
    roundNumber?: number;
    convertMinusSignToWord?: boolean;
    showNumberParts?: { integer: boolean; fractional: boolean };
    convertNumberToWords?: { integer: boolean; fractional: boolean };
    showCurrency?: { integer: boolean; fractional: boolean };
  }

  export function convert(number: string | number, options?: ConvertOptions): string;
}