// html-to-docx.d.ts
declare module 'html-to-docx' {
  interface HtmlToDocxOptions {
    header?: boolean;
    footer?: boolean;
    margins?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
    [key: string]: any;
  }

  export default function htmlToDocx(
    html: string,
    options?: HtmlToDocxOptions
  ): Promise<Buffer | ArrayBuffer | Uint8Array>;
}