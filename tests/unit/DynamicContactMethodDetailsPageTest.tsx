import {act, render} from '@testing-library/react-native';

import HTMLEngineProvider from '@components/HTMLEngineProvider';

import useDynamicBackPath from '@hooks/useDynamicBackPath';

import * as UserActions from '@libs/actions/User';
import Navigation from '@libs/Navigation/Navigation';

import DynamicContactMethodDetailsPage from '@pages/settings/Profile/Contacts/DynamicContactMethodDetailsPage';

import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES, {DYNAMIC_ROUTES} from '@src/ROUTES';

import {useIsFocused} from '@react-navigation/native';
import Onyx from 'react-native-onyx';

import type {MockFetch} from '../utils/TestHelper';

import {getGlobalFetchMock} from '../utils/TestHelper';
import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

jest.mock('@react-navigation/native', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const actualNav = jest.requireActual('@react-navigation/native');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...actualNav,
        useIsFocused: jest.fn(() => true),
        useRoute: jest.fn(() => ({name: '', key: '', params: {}})),
        usePreventRemove: jest.fn(),
    };
});

jest.mock('@libs/Navigation/Navigation', () => ({
    getActiveRoute: jest.fn(() => ''),
    getActiveRouteWithoutParams: jest.fn(() => ''),
    isNavigationReady: jest.fn(() => Promise.resolve()),
    goBack: jest.fn(),
}));

jest.mock('@hooks/useDynamicBackPath', () => jest.fn(() => ''));

jest.mock('@components/DelegateNoAccessModalProvider', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const actual = jest.requireActual('@components/DelegateNoAccessModalProvider');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...actual,
        useDelegateNoAccessState: () => ({isActingAsDelegate: false, isDelegateAccessRestricted: false}),
        useDelegateNoAccessActions: () => ({showDelegateNoAccessModal: jest.fn()}),
    };
});

jest.mock('@libs/actions/User', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const originalModule = jest.requireActual('@libs/actions/User');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...originalModule,
        resetContactMethodValidateCodeSentState: jest.fn(),
    };
});

function HTMLProviderWrapper({children}: {children: React.ReactNode}) {
    return <HTMLEngineProvider>{children}</HTMLEngineProvider>;
}

const fakeEmail = 'fake@gmail.com';
const contactMethodsPath = 'settings/profile/contact-methods';
const contactDetailsPath = `${contactMethodsPath}/${DYNAMIC_ROUTES.CONTACT_METHOD_DETAILS.getRoute(fakeEmail)}`;
const testToolsPath = ROUTES.TEST_TOOLS_MODAL.getRoute(contactDetailsPath);
const mockRoute = {
    params: {
        contactMethod: fakeEmail,
    },
};
const mockLoginList = {
    [`1_${fakeEmail}`]: {
        partnerID: 1,
        partnerUserID: fakeEmail,
        validatedDate: 'fake-validatedDate',
    },
};

describe('DynamicContactMethodDetailsPage', () => {
    let mockFetch: MockFetch;
    beforeAll(() => {
        Onyx.init({
            keys: ONYXKEYS,
        });
    });
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useIsFocused).mockReturnValue(true);
        jest.mocked(useDynamicBackPath).mockReturnValue(contactMethodsPath);
        jest.mocked(Navigation.getActiveRoute).mockReturnValue(contactDetailsPath);
        const globalFetchMock = getGlobalFetchMock();
        global.fetch = globalFetchMock;
        mockFetch = globalFetchMock;
        return Onyx.clear().then(waitForBatchedUpdates);
    });

    function ContactMethodDetailsPageRenderer() {
        return (
            <HTMLProviderWrapper>
                <DynamicContactMethodDetailsPage
                    // @ts-expect-error - Ignoring type errors for testing purposes
                    route={mockRoute}
                />
            </HTMLProviderWrapper>
        );
    }

    it('should not call resetContactMethodValidateCodeSentState when we got a delete pending field', async () => {
        // Given a login list with a validated contact method
        Onyx.merge(ONYXKEYS.LOGINS, mockLoginList);
        await waitForBatchedUpdates();

        // Given the page is rendered
        render(<ContactMethodDetailsPageRenderer />);

        // When a deleteContactMethod called
        UserActions.deleteContactMethod(fakeEmail, mockLoginList);
        await waitForBatchedUpdatesWithAct();

        // When the deletion is successful
        mockFetch?.succeed();
        await waitForBatchedUpdates();
        mockFetch?.resume();
        await waitForBatchedUpdates();

        // Then resetContactMethodValidateCodeSentState should not be called
        expect(UserActions.resetContactMethodValidateCodeSentState).not.toHaveBeenCalled();
    });

    it('should not call resetContactMethodValidateCodeSentState when the login data has no partnerUserID', async () => {
        // Given a login list with a contact method that has no partnerUserID
        Onyx.merge(ONYXKEYS.LOGINS, {
            [`1_${fakeEmail}`]: {
                partnerID: 1,

                partnerUserID: '',
                validatedDate: '',
            },
        });
        await waitForBatchedUpdates();

        // Given the page is rendered
        render(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // Then resetContactMethodValidateCodeSentState should not be called
        expect(UserActions.resetContactMethodValidateCodeSentState).not.toHaveBeenCalled();
    });

    it('calls Navigation.goBack when contact method becomes validated and screen is focused', async () => {
        // Given an unvalidated contact method is open and focused
        Onyx.merge(ONYXKEYS.SESSION, {email: fakeEmail});
        Onyx.merge(ONYXKEYS.IS_LOADING_REPORT_DATA, false);
        Onyx.merge(ONYXKEYS.LOGINS, {
            [`1_${fakeEmail}`]: {
                partnerID: 1,

                partnerUserID: fakeEmail,
                validatedDate: '',
            },
        });
        await waitForBatchedUpdates();

        render(<ContactMethodDetailsPageRenderer />);
        await waitForBatchedUpdatesWithAct();

        // When validation succeeds
        await act(async () => {
            Onyx.merge(ONYXKEYS.LOGINS, {
                [`1_${fakeEmail}`]: {
                    partnerID: 1,

                    partnerUserID: fakeEmail,
                    validatedDate: '2024-01-01',
                },
            });
        });
        await waitForBatchedUpdatesWithAct();

        // Then navigation returns to the contact methods list
        expect(Navigation.goBack).toHaveBeenCalledTimes(1);
        expect(Navigation.goBack).toHaveBeenCalledWith(contactMethodsPath);
    });

    describe('navigation after validation', () => {
        async function renderUnvalidatedContact() {
            await Onyx.merge(ONYXKEYS.IS_LOADING_REPORT_DATA, false);
            await Onyx.merge(ONYXKEYS.LOGINS, {
                [`1_${fakeEmail}`]: {...mockLoginList[`1_${fakeEmail}`], validatedDate: ''},
            });
            await waitForBatchedUpdates();
            const result = render(<ContactMethodDetailsPageRenderer />);
            await waitForBatchedUpdatesWithAct();
            return result;
        }

        async function validateContact() {
            await act(async () => {
                await Onyx.merge(ONYXKEYS.LOGINS, mockLoginList);
            });
            await waitForBatchedUpdatesWithAct();
        }

        it.each([true, false])('returns once when focus arrives before the cached path refresh: %s', async (isValidationCovered) => {
            // Given Test Tools has left its URL in the cached back path
            jest.mocked(useIsFocused).mockReturnValue(!isValidationCovered);
            jest.mocked(useDynamicBackPath).mockReturnValue(testToolsPath);
            jest.mocked(Navigation.getActiveRoute).mockReturnValue(isValidationCovered ? testToolsPath : contactDetailsPath);
            const page = await renderUnvalidatedContact();

            // When validation succeeds before the cached path catches up with focus
            await validateContact();
            if (isValidationCovered) {
                expect(Navigation.goBack).not.toHaveBeenCalled();
                jest.mocked(useIsFocused).mockReturnValue(true);
                jest.mocked(Navigation.getActiveRoute).mockReturnValue(contactDetailsPath);
                page.rerender(<ContactMethodDetailsPageRenderer />);
                await waitForBatchedUpdatesWithAct();
            }

            // Then only the live contact methods parent is used, even after another path update
            expect(Navigation.goBack).toHaveBeenCalledTimes(1);
            expect(Navigation.goBack).toHaveBeenCalledWith(contactMethodsPath);
            jest.mocked(useDynamicBackPath).mockReturnValue(contactMethodsPath);
            page.rerender(<ContactMethodDetailsPageRenderer />);
            await waitForBatchedUpdatesWithAct();
            expect(Navigation.goBack).toHaveBeenCalledTimes(1);
        });

        it.each(['', testToolsPath, `${contactMethodsPath}/another%40gmail.com/details`, DYNAMIC_ROUTES.CONTACT_METHOD_DETAILS.getRoute(fakeEmail)])(
            'retains pending navigation while the live destination is invalid: %s',
            async (activePath) => {
                // Given validation completes while a covering screen is focused
                jest.mocked(useIsFocused).mockReturnValue(false);
                jest.mocked(useDynamicBackPath).mockReturnValue(testToolsPath);
                const page = await renderUnvalidatedContact();
                await validateContact();

                // When focus arrives before a usable route for this contact method
                jest.mocked(useIsFocused).mockReturnValue(true);
                jest.mocked(Navigation.getActiveRoute).mockReturnValue(activePath);
                page.rerender(<ContactMethodDetailsPageRenderer />);
                await waitForBatchedUpdatesWithAct();
                expect(Navigation.goBack).not.toHaveBeenCalled();

                // Then a subsequent path update retries the pending navigation exactly once
                jest.mocked(Navigation.getActiveRoute).mockReturnValue(contactDetailsPath);
                jest.mocked(useDynamicBackPath).mockReturnValue(contactMethodsPath);
                page.rerender(<ContactMethodDetailsPageRenderer />);
                await waitForBatchedUpdatesWithAct();
                expect(Navigation.goBack).toHaveBeenCalledTimes(1);
                expect(Navigation.goBack).toHaveBeenCalledWith(contactMethodsPath);
            },
        );

        it.each(['settings/profile/contact-methods', 'r/123/contact-methods?backTo=home'])('preserves the dynamic parent and its query: %s', async (parentPath) => {
            // Given the details page can be opened from different contact methods entry points
            const page = await renderUnvalidatedContact();
            const [parent, query] = parentPath.split('?');
            jest.mocked(Navigation.getActiveRoute).mockReturnValue(
                `${parent}/${DYNAMIC_ROUTES.CONTACT_METHOD_DETAILS.getRoute(fakeEmail)}?${query ? `${query}&` : ''}shouldSkipInitialValidation=true`,
            );

            // When validation succeeds with a stale cached parent
            jest.mocked(useDynamicBackPath).mockReturnValue(testToolsPath);
            page.rerender(<ContactMethodDetailsPageRenderer />);
            await validateContact();

            // Then only the details suffix and its own query parameters are removed
            expect(Navigation.goBack).toHaveBeenCalledTimes(1);
            expect(Navigation.goBack).toHaveBeenCalledWith(parentPath);
        });

        it('does not leave an already validated contact method on focus changes', async () => {
            // Given an existing validated contact is opened under another screen
            jest.mocked(useIsFocused).mockReturnValue(false);
            await Onyx.merge(ONYXKEYS.LOGINS, mockLoginList);
            await waitForBatchedUpdates();
            const page = render(<ContactMethodDetailsPageRenderer />);
            await waitForBatchedUpdatesWithAct();

            // When that contact method regains focus
            jest.mocked(useIsFocused).mockReturnValue(true);
            page.rerender(<ContactMethodDetailsPageRenderer />);
            await waitForBatchedUpdatesWithAct();

            // Then no validation transition has occurred to request navigation
            expect(Navigation.goBack).not.toHaveBeenCalled();
        });
    });
});
