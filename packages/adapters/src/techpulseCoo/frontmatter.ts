import matter from 'gray-matter'

export function readStatus(content: string): string {
  const { data } = matter(content)
  if (typeof data.status !== 'string') {
    throw new Error('frontmatter has no status field')
  }
  return data.status
}

export function setStatus(content: string, status: string): string {
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/)
  if (!fmMatch || fmMatch.index === undefined) {
    throw new Error('no YAML frontmatter block found')
  }
  const block = fmMatch[0]
  const statusLineRe = /^status:\s*.*$/m
  if (!statusLineRe.test(block)) {
    throw new Error('frontmatter has no status line to replace')
  }
  const newBlock = block.replace(statusLineRe, `status: ${status}`)
  return (
    content.slice(0, fmMatch.index) +
    newBlock +
    content.slice(fmMatch.index + block.length)
  )
}
