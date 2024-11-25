import { GitUtils } from '../utils/git';
import { LanguageService } from './languageService';

export class RepoService {
    constructor(private readonly gitUtils: GitUtils,
                private readonly languageService: LanguageService
    ) {}

    async getFullRepoName(repoName: string): Promise<string> {
        const strings = this.languageService.getStringsForLanguage(
            this.languageService.getCurrentLanguage()
        );

        if (repoName.includes('/')) {
            return repoName;
        }
    
        try {
            const orgsCommand = `gh api /user/memberships/orgs --jq '.[].organization.login'`;
            const orgs = await this.gitUtils.execCommand(orgsCommand)
                .then(result => result.trim().split('\n'))
                .catch(() => {
                    throw new Error(strings.error_user_orgs);
                });
            
            for (const org of orgs) {
                try {
                    await this.gitUtils.execCommand(`gh repo view ${org}/${repoName}`);
                    return `${org}/${repoName}`;
                } catch {
                    continue;
                }
            }
            
            const userName = await this.gitUtils.execCommand('gh api user --jq .login')
                .then(result => result.trim())
                .catch(() => {
                    throw new Error(strings.error_user_name);
                });

            const fullRepoName = `${userName}/${repoName}`;
            try {
                await this.gitUtils.execCommand(`gh repo view ${fullRepoName}`);
                return fullRepoName;
            } catch {
                throw new Error(strings.rp_error_repo_access.replace('{0}', fullRepoName));
            }

        } catch (error: any) {
            throw new Error(strings.error_repo_name.replace('{0}', repoName));
        }
    }
}