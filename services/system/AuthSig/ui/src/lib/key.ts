export const pemToBase64 = (pemKey: string): string => {
  // Remove the PEM header and footer
  const pemLines = pemKey.split("\n");
  const filteredLines = pemLines.filter(
    (line) => !line.includes("-----BEGIN") && !line.includes("-----END")
  );

  // Join the lines and remove any additional whitespace
  const keyContent = filteredLines.join("").trim();

  // Convert the key content to Base64
  const base64Key = btoa(keyContent); // Use btoa for browser environments

  return base64Key;
};

export const base64ToPem = (
  base64Key: string,
  keyType: string = "PRIVATE KEY"
): string => {
  // Decode the Base64 key
  const keyContent = atob(base64Key); // Use atob for browser environments

  // Add the PEM header and footer
  const pemKey =
    `-----BEGIN ${keyType}-----\n` +
    keyContent.match(/.{1,64}/g)?.join("\n") +
    `\n-----END ${keyType}-----\n`;

  return pemKey;
};
