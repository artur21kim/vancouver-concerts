import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms and Conditions — Grooveprint',
  description: 'Terms and conditions governing your use of Grooveprint.',
}

const a = 'underline text-foreground hover:opacity-75 transition-opacity'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Header */}
        <h1 className="text-3xl font-bold text-foreground mb-2">Terms and Conditions</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: June 08, 2026</p>

        <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">

          <p>Please read these terms and conditions carefully before using Our Service.</p>

          {/* ── Interpretation and Definitions ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">
            Interpretation and Definitions
          </h2>

          <h3 className="text-base font-semibold text-foreground pt-4 pb-1">Interpretation</h3>
          <p>
            The words whose initial letters are capitalized have meanings defined under the following
            conditions. The following definitions shall have the same meaning regardless of whether
            they appear in singular or in plural.
          </p>

          <h3 className="text-base font-semibold text-foreground pt-4 pb-1">Definitions</h3>
          <p>For the purposes of these Terms and Conditions:</p>

          <div className="space-y-3">
            <p><strong className="text-foreground">Affiliate</strong> means an entity that controls, is controlled by, or is under common control with a party, where &quot;control&quot; means ownership of 50% or more of the shares, equity interest or other securities entitled to vote for election of directors or other managing authority.</p>
            <p><strong className="text-foreground">Country</strong> refers to: British Columbia, Canada.</p>
            <p><strong className="text-foreground">Company</strong> (referred to as either &quot;the Company&quot;, &quot;We&quot;, &quot;Us&quot; or &quot;Our&quot; in these Terms and Conditions) refers to Grooveprint.</p>
            <p><strong className="text-foreground">Device</strong> means any device that can access the Service such as a computer, a cell phone or a digital tablet.</p>
            <p><strong className="text-foreground">Service</strong> refers to the Website.</p>
            <p><strong className="text-foreground">Terms and Conditions</strong> (also referred to as &quot;Terms&quot;) means these Terms and Conditions, which govern Your access to and use of the Service and form the entire agreement between You and the Company regarding the Service.</p>
            <p><strong className="text-foreground">Third-Party Social Media Service</strong> means any services or content provided by a third party that is displayed, included, made available, or linked to through the Service.</p>
            <p><strong className="text-foreground">Website</strong> refers to Grooveprint, accessible from{' '}
              <a href="https://grooveprint.app" className={a}>https://grooveprint.app</a>.
            </p>
            <p><strong className="text-foreground">You</strong> means the individual accessing or using the Service, or the company, or other legal entity on behalf of which such individual is accessing or using the Service, as applicable.</p>
          </div>

          {/* ── Acknowledgment ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Acknowledgment</h2>
          <p>
            These are the Terms and Conditions governing the use of this Service and the agreement
            between You and the Company. These Terms and Conditions set out the rights and obligations
            of all users regarding the use of the Service.
          </p>
          <p>
            Your access to and use of the Service is conditioned on Your acceptance of and compliance
            with these Terms and Conditions. These Terms and Conditions apply to all visitors, users
            and others who access or use the Service.
          </p>
          <p>
            By accessing or using the Service You agree to be bound by these Terms and Conditions.
            If You disagree with any part of these Terms and Conditions then You may not access
            the Service.
          </p>
          <p>
            You represent that you are at least 16 years of age. The Company does not permit those
            under the age of 16 to use the Service.
          </p>
          <p>
            Your access to and use of the Service is also subject to Our{' '}
            <a href="/privacy" className={a}>Privacy Policy</a>, which describes how We collect, use,
            and disclose personal information. Please read Our Privacy Policy carefully before using
            Our Service.
          </p>

          {/* ── Links to Other Websites ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Links to Other Websites</h2>
          <p>
            Our Service may contain links to third-party websites or services that are not owned or
            controlled by the Company.
          </p>
          <p>
            The Company has no control over, and assumes no responsibility for, the content, privacy
            policies, or practices of any third-party websites or services. You further acknowledge
            and agree that the Company shall not be responsible or liable, directly or indirectly,
            for any damage or loss caused or alleged to be caused by or in connection with the use of
            or reliance on any such content, goods or services available on or through any such
            websites or services.
          </p>
          <p>
            We strongly advise You to read the terms and conditions and privacy policies of any
            third-party websites or services that You visit.
          </p>

          {/* ── Links from Third-Party Social Media ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">
            Links from a Third-Party Social Media Service
          </h2>
          <p>
            The Service may display, include, make available, or link to content or services provided
            by a Third-Party Social Media Service. A Third-Party Social Media Service is not owned or
            controlled by the Company, and the Company does not endorse or assume responsibility for
            any Third-Party Social Media Service.
          </p>
          <p>
            You acknowledge and agree that the Company shall not be responsible or liable, directly or
            indirectly, for any damage or loss caused or alleged to be caused by or in connection with
            Your access to or use of any Third-Party Social Media Service, including any content, goods,
            or services made available through them. Your use of any Third-Party Social Media Service
            is governed by that service&apos;s own terms and privacy policies.
          </p>

          {/* ── Termination ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Termination</h2>
          <p>
            We may terminate or suspend Your access immediately, without prior notice or liability,
            for any reason whatsoever, including without limitation if You breach these Terms and
            Conditions.
          </p>
          <p>Upon termination, Your right to use the Service will cease immediately.</p>

          {/* ── Limitation of Liability ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Limitation of Liability</h2>
          <p>
            Notwithstanding any damages that You might incur, the entire liability of the Company and
            any of its suppliers under any provision of these Terms and Your exclusive remedy for all
            of the foregoing shall be limited to the amount actually paid by You through the Service
            or 100 USD if You haven&apos;t purchased anything through the Service.
          </p>
          <p>
            To the maximum extent permitted by applicable law, in no event shall the Company or its
            suppliers be liable for any special, incidental, indirect, or consequential damages
            whatsoever (including, but not limited to, damages for loss of profits, loss of data or
            other information, for business interruption, for personal injury, loss of privacy arising
            out of or in any way related to the use of or inability to use the Service, third-party
            software and/or third-party hardware used with the Service, or otherwise in connection
            with any provision of these Terms), even if the Company or any supplier has been advised
            of the possibility of such damages and even if the remedy fails of its essential purpose.
          </p>
          <p>
            Some jurisdictions do not allow the exclusion of implied warranties or limitation of
            liability for incidental or consequential damages, which means that some of the above
            limitations may not apply. In these jurisdictions, each party&apos;s liability will be
            limited to the greatest extent permitted by law.
          </p>

          {/* ── AS IS Disclaimer ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">
            &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; Disclaimer
          </h2>
          <p>
            The Service is provided to You &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; and with all faults and defects
            without warranty of any kind. To the maximum extent permitted under applicable law, the
            Company expressly disclaims all warranties, whether express, implied, statutory or
            otherwise, with respect to the Service, including all implied warranties of
            merchantability, fitness for a particular purpose, title and non-infringement.
          </p>
          <p>
            Without limiting the foregoing, neither the Company nor any of the company&apos;s providers
            makes any representation or warranty of any kind, express or implied: (i) as to the
            operation or availability of the Service; (ii) that the Service will be uninterrupted or
            error-free; (iii) as to the accuracy, reliability, or currency of any information or
            content provided through the Service; or (iv) that the Service, its servers, the content,
            or e-mails sent from or on behalf of the Company are free of viruses, scripts, trojan
            horses, worms, malware, timebombs or other harmful components.
          </p>
          <p>
            Some jurisdictions do not allow the exclusion of certain types of warranties or limitations
            on applicable statutory rights of a consumer, so some or all of the above exclusions and
            limitations may not apply to You.
          </p>

          {/* ── Governing Law ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Governing Law</h2>
          <p>
            The laws of British Columbia, Canada govern these Terms and Your use of the Service,
            excluding conflicts of law rules. Privacy matters are additionally governed by the federal
            Personal Information Protection and Electronic Documents Act (PIPEDA) and the British
            Columbia Personal Information Protection Act (PIPA). Your use of the Service may also be
            subject to other applicable local or national laws.
          </p>
          <p>
            The Service is operated from British Columbia, Canada. If You access the Service from
            outside Canada, You do so at Your own discretion and are responsible for compliance with
            any applicable local laws. These Terms are governed by the laws of British Columbia
            regardless of where You are located.
          </p>

          {/* ── Disputes Resolution ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Disputes Resolution</h2>
          <p>
            If You have any concern or dispute about the Service, You agree to first try to resolve
            the dispute informally by contacting the Company.
          </p>

          {/* ── Severability and Waiver ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Severability and Waiver</h2>

          <h3 className="text-base font-semibold text-foreground pt-4 pb-1">Severability</h3>
          <p>
            If any provision of these Terms is held to be unenforceable or invalid, such provision
            will be changed and interpreted to accomplish the objectives of such provision to the
            greatest extent possible under applicable law and the remaining provisions will continue
            in full force and effect.
          </p>

          <h3 className="text-base font-semibold text-foreground pt-4 pb-1">Waiver</h3>
          <p>
            Except as provided herein, the failure to exercise a right or to require performance of
            an obligation under these Terms shall not affect a party&apos;s ability to exercise such
            right or require such performance at any time thereafter nor shall the waiver of a breach
            constitute a waiver of any subsequent breach.
          </p>

          {/* ── Translation ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Translation Interpretation</h2>
          <p>
            These Terms and Conditions may have been translated if We have made them available to You
            on our Service. You agree that the original English text shall prevail in the case of
            a dispute.
          </p>

          {/* ── Changes ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">
            Changes to These Terms and Conditions
          </h2>
          <p>
            We reserve the right, at Our sole discretion, to modify or replace these Terms at any
            time. If a revision is material We will make reasonable efforts to provide at least 30
            days&apos; notice prior to any new terms taking effect. What constitutes a material change
            will be determined at Our sole discretion.
          </p>
          <p>
            By continuing to access or use Our Service after those revisions become effective, You
            agree to be bound by the revised terms. If You do not agree to the new terms, in whole or
            in part, please stop using the Service.
          </p>

          {/* ── Spotify Integration ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Spotify Integration</h2>
          <p>
            By connecting Your Spotify account, You authorise the Company to access Your liked songs
            and artist data via the Spotify Web API in accordance with Spotify&apos;s Terms of Service.
            You may disconnect Your Spotify account at any time through the Settings page.
            Disconnecting Your Spotify account will result in the removal of Your Spotify data from
            the Service.
          </p>

          {/* ── Third-Party Data and Attribution ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">
            Third-Party Data and Attribution
          </h2>
          <p>
            Concert data displayed on the Service is sourced from{' '}
            <a href="https://www.setlist.fm" target="_blank" rel="noopener noreferrer" className={a}>setlist.fm</a>
            {' '}and used under the{' '}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer" className={a}>Creative Commons CC BY-NC-SA 4.0</a>
            {' '}licence. Links to Ticketmaster and setlist.fm are provided for convenience only.
            The Company is not responsible for the content, accuracy, or availability of third-party
            websites, nor for any ticket transactions conducted through Ticketmaster or any other
            third-party service.
          </p>

          {/* ── Contact Us ── */}
          <h2 className="text-xl font-semibold text-foreground pt-8 pb-1">Contact Us</h2>
          <p>
            If you have any questions about these Terms and Conditions, You can contact us by email
            at{' '}
            <a href="mailto:artur@grooveprint.app" className={a}>artur@grooveprint.app</a>.
          </p>

        </div>
      </div>
    </div>
  )
}
