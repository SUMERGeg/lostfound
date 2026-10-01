import { migration as baseline } from './001_baseline.js'
import { migration as webAuth } from './002_web_auth.js'
import { migration as uploads } from './003_uploads.js'
import { migration as emailDelivery } from './004_email_delivery.js'
import { migration as ownerChecks } from './005_owner_checks.js'
import { migration as matchingV1 } from './006_matching_v1.js'
import { migration as moderation } from './007_moderation.js'
import { migration as userConsents } from './008_user_consents.js'
import { migration as contactDisclosure } from './009_contact_disclosure.js'
import { migration as accountDeletion } from './010_account_deletion.js'
import { migration as privacyRequests } from './011_privacy_requests.js'

export const migrations = [baseline, webAuth, uploads, emailDelivery, ownerChecks, matchingV1, moderation, userConsents, contactDisclosure, accountDeletion, privacyRequests]
