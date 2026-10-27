// Which site a build is. The same app runs as the main site
// (r5vers.github.io) and as the test copy under /next/, which keeps its own
// storage - the database "rv-next" and localStorage keys under "nx" - and
// stays off the group's cloud. tools/build_site.py writes `false` here when
// it builds the main site.
export const TEST_COPY = true;

/** This site's database and localStorage names. The main site's are the
 *  ones it has always had, so its profiles, sessions and cloud link stay. */
export const LOCAL_NAMES = TEST_COPY
  ? { db: 'rv-next', light: 'nx-light-db', scope: 'nx:', lastLook: 'nx-last-look', device: 'nx-device:', gateBg: 'nx-gate-bg', gateLook: 'nx-gate-look', errors: 'nx-errors', mode: 'nx-mode' }
  : { db: 'rv-local', light: 'rv-light-db', scope: 'rt:', lastLook: 'rt-last-look', device: 'rt-device:', gateBg: 'rt-gate-bg', gateLook: 'rt-gate-look', errors: 'rv-errors', mode: 'rv-mode' };

/** How the site names itself under a profile's name. */
export const SITE_TAG = TEST_COPY ? 'RV Next · test sürümü' : 'ReplayView';
