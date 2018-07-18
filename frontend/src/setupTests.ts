import 'whatwg-fetch';

import * as fetch from 'jest-fetch-mock';

(global as any).fetch = fetch;
