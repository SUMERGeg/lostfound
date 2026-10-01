export function createEmailProvider(environment = process.env) {
  const apiUrl = environment.EMAIL_API_URL
  const apiToken = environment.EMAIL_API_TOKEN
  const from = environment.EMAIL_FROM

  if (!apiUrl || !apiToken || !from) {
    if (environment.NODE_ENV === 'production') {
      throw new Error('EMAIL_API_URL, EMAIL_API_TOKEN and EMAIL_FROM are required in production')
    }
    return {
      async send(message) {
        console.info('[email] development delivery', {
          to: message.to,
          template: message.template
        })
      }
    }
  }

  return {
    async send(message) {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text
        })
      })
      if (!response.ok) {
        throw new Error(`Email provider returned ${response.status}`)
      }
    }
  }
}
