export class SecretDetectedError extends Error {
  patterns: string[]
  constructor(patterns: string[]) {
    super(`Secret(s) detected in content: ${patterns.join(', ')}`)
    this.name = 'SecretDetectedError'
    this.patterns = patterns
  }
}

interface SecretPattern {
  name: string
  re: RegExp
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'github_token',
    re: /gh[oprsu]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/,
  },
  { name: 'anthropic_key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai_key', re: /sk-(?!ant-)[A-Za-z0-9_-]{20,}/ },
  { name: 'private_key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
]

export function findSecrets(text: string): string[] {
  const matched: string[] = []
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) matched.push(name)
  }
  return matched
}
