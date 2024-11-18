import { GitUtils } from '../utils/git';

export class RepoService {
    constructor(private readonly gitUtils: GitUtils) {}

    async getFullRepoName(repoName: string): Promise<string> {
        if (repoName.includes('/')) {
            return repoName;
        }
    
        try {
            const orgsCommand = `gh api /user/memberships/orgs --jq '.[].organization.login'`;
            const orgs = (await this.gitUtils.execCommand(orgsCommand)).trim().split('\n');
            
            for (const org of orgs) {
                try {
                    await this.gitUtils.execCommand(`gh repo view ${org}/${repoName}`);
                    return `${org}/${repoName}`;
                } catch {
                    continue;
                }
            }
            
            const userName = (await this.gitUtils.execCommand('gh api user --jq .login')).trim();
            return `${userName}/${repoName}`;
        } catch (error) {
            throw new Error(`Could not determine full repository name for ${repoName}`);
        }
    }
}