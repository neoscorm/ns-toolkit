// Toolkit settings that change without editing the interface code.

const env = import.meta.env;

export const config = {
  /** The studio's main site */
  siteUrl: 'https://neoscorm.com/',
  /**
   * Where the button on a problem package card leads. The source tag in the address (UTM) —
   * "from toolkit", with no course names or paths: it marks a form request as coming from the toolkit.
   */
  contactUrl: 'https://neoscorm.com/?utm_source=toolkit&utm_medium=package-card',
  /** Link to the source code. An empty string — the link is not shown */
  githubUrl: '',
  /**
   * Sandbox address (the player). It must be a different origin than the toolkit:
   * course code must not have access to toolkit data. Changed with the VITE_SANDBOX_ORIGIN variable.
   */
  sandboxOrigin:
    (env.VITE_SANDBOX_ORIGIN as string | undefined) || (env.DEV ? 'http://localhost:5174' : 'https://sandbox.neoscorm.com'),
};
