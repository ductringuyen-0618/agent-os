import { describe, expect, it } from 'vitest'
import { SecretDetectedError, findSecrets } from './redact.js'

describe('findSecrets', () => {
  it('returns [] for clean text', () => {
    expect(findSecrets('nothing to see here, just prose about wikis')).toEqual(
      [],
    )
  })
  it('detects an AWS access key', () => {
    expect(findSecrets('key = AKIAABCDEFGHIJKLMNOP')).toContain(
      'aws_access_key',
    )
  })
  it('detects a GitHub ghp_ token', () => {
    expect(findSecrets(`token: ghp_${'a'.repeat(36)}`)).toContain(
      'github_token',
    )
  })
  it('detects a GitHub fine-grained github_pat_ token', () => {
    expect(findSecrets(`github_pat_${'1'.repeat(30)}`)).toContain(
      'github_token',
    )
  })
  it('detects an OpenAI key', () => {
    expect(findSecrets(`sk-${'x'.repeat(30)}`)).toContain('openai_key')
  })
  it('detects an Anthropic key without also flagging it as openai', () => {
    const secrets = findSecrets(`sk-ant-${'y'.repeat(30)}`)
    expect(secrets).toContain('anthropic_key')
    expect(secrets).not.toContain('openai_key')
  })
  it('detects modern hyphenated OpenAI key formats (sk-proj-, sk-svcacct-)', () => {
    expect(findSecrets(`sk-proj-${'x'.repeat(40)}`)).toContain('openai_key')
    expect(findSecrets(`sk-svcacct-${'x'.repeat(40)}`)).toContain('openai_key')
  })
  it('detects gho_/ghu_/ghs_/ghr_ GitHub token prefixes', () => {
    expect(findSecrets(`token: gho_${'a'.repeat(36)}`)).toContain(
      'github_token',
    )
    expect(findSecrets(`token: ghu_${'a'.repeat(36)}`)).toContain(
      'github_token',
    )
    expect(findSecrets(`token: ghs_${'a'.repeat(36)}`)).toContain(
      'github_token',
    )
    expect(findSecrets(`token: ghr_${'a'.repeat(36)}`)).toContain(
      'github_token',
    )
  })
  it('detects a PEM private key header', () => {
    expect(findSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIB...')).toContain(
      'private_key',
    )
  })
  it('can report multiple matches', () => {
    const secrets = findSecrets(`AKIAABCDEFGHIJKLMNOP and sk-${'x'.repeat(30)}`)
    expect(secrets.sort()).toEqual(['aws_access_key', 'openai_key'])
  })
})

describe('SecretDetectedError', () => {
  it('carries the matched pattern names', () => {
    const err = new SecretDetectedError(['aws_access_key'])
    expect(err.patterns).toEqual(['aws_access_key'])
    expect(err.message).toContain('aws_access_key')
    expect(err).toBeInstanceOf(Error)
  })
})
