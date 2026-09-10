declare module "qrcode/lib/browser.js" {
  const QRCode: {
    toDataURL(
      text: string,
      options: { width: number; margin: number; errorCorrectionLevel: "M" }
    ): Promise<string>;
  };
  export default QRCode;
}
