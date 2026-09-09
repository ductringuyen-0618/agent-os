export interface GithubRepo {
  nameWithOwner: string
  description: string | null
  defaultBranch: string
  isPrivate: boolean
  updatedAt: string
}
