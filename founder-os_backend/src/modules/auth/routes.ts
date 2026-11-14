import { authEnabled, getGoogleConfig } from "./service";
import { ROOT_EMAIL } from "./types";

// Pieces split into ./routes-parts/ (importable on their own); re-exported for compat.
export type { AuthResult } from "./routes-parts/types";
export { authLogin, authCallback, authMe, authLogout, authListUsers, authListScopes, authCreateScope, authDeleteScope, authSetUserScopes, authListRoles, authCreateRole, authDeleteRole, authSetUserRoles, authSetUserProfile, authDeleteUser } from "./routes-parts/io";

export { authEnabled, getGoogleConfig, ROOT_EMAIL };
