export interface EmailSender {
  sendMagicLink(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink(to: string, url: string) {
    console.info(`[local email] magic link for ${to}: ${url}`);
  }
  async sendPasswordReset(to: string, url: string) {
    console.info(`[local email] password reset for ${to}: ${url}`);
  }
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  private async send(to: string, subject: string, text: string) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Resend failed with ${response.status}`);
  }

  async sendMagicLink(to: string, url: string) {
    await this.send(to, "Tu enlace para entrar a Botwa", `Entra a Botwa con este enlace (vence en 15 minutos): ${url}`);
  }

  async sendPasswordReset(to: string, url: string) {
    await this.send(
      to,
      "Restablecé tu contraseña de Botwa",
      `Recibimos una solicitud para restablecer tu contraseña. Si la hiciste vos, usá este enlace (vence en 1 hora): ${url}\n\nSi no la pediste, ignoralo.`,
    );
  }
}
