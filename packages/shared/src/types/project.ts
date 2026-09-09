export interface ProjectConfig {
  name: string
  adapter: string
  repo: string
  clone: string
  base_branch: string
  options: Record<string, unknown>
}
