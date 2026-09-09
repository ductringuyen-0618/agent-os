export const GITLEAKS_TOML = `title = "agent-os gitleaks config"

[extend]
useDefault = true

[[rules]]
id = "aws-access-key"
description = "AWS Access Key ID"
regex = '''AKIA[0-9A-Z]{16}'''
tags = ["key", "aws"]

[[rules]]
id = "github-pat"
description = "GitHub Personal Access Token"
regex = '''gh[pousr]_[0-9A-Za-z]{36,255}'''
tags = ["key", "github"]

[[rules]]
id = "openai-key"
description = "OpenAI API Key"
regex = '''sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}'''
tags = ["key", "openai"]

[[rules]]
id = "anthropic-key"
description = "Anthropic API Key"
regex = '''sk-ant-[A-Za-z0-9_-]{20,}'''
tags = ["key", "anthropic"]

[[rules]]
id = "private-key-block"
description = "Private key block"
regex = '''-----BEGIN [A-Z ]*PRIVATE KEY-----'''
tags = ["key", "private-key"]

[allowlist]
description = "Template placeholders are not real secrets"
regexes = [
  '''sk-ant-EXAMPLE''',
  '''ghp_EXAMPLE''',
]
`
