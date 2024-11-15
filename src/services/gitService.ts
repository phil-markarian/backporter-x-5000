import { GitUtils } from '../utils/git';
import { RepoService } from './repoService';

export class GitService {
    constructor(
        private readonly gitUtils: GitUtils,
        private readonly repoService: RepoService
    ) {}

    async fetchGitHubUsers(repoName: string): Promise<string[]> {
        try {
            const fullRepoName = await this.repoService.getFullRepoName(repoName);
            const orgName = fullRepoName.split('/')[0];
            
            const [orgMembers, collaborators] = await Promise.all([
                this.gitUtils.execCommand(`gh api orgs/${orgName}/members --jq '.[].login'`),
                this.gitUtils.execCommand(`gh api repos/${fullRepoName}/collaborators --jq '.[].login'`)
            ]);

            const allUsers = new Set([
                ...orgMembers.split('\n'),
                ...collaborators.split('\n')
            ].filter(user => user.trim()));

            return Array.from(allUsers);
        } catch (error) {
            console.error('Error fetching GitHub users:', error);
            return [];
        }
    }
}