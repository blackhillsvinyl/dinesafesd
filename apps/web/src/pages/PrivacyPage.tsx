export default function PrivacyPage() {
  return (
    <div className="page">
      <h1>Privacy Policy</h1>
      <p className="small">Last updated: July 7, 2026</p>

      <p>
        DineSafeSD (&quot;the app&quot;) is a free service that displays public-record restaurant
        health inspection data for South Dakota. This policy describes what information the app
        does and does not handle.
      </p>

      <h2>Information we collect</h2>
      <p>
        <b>None.</b> DineSafeSD has no user accounts, no analytics, no advertising, and no
        tracking. We do not collect, store, sell, or share any personal information.
      </p>

      <h2>Location</h2>
      <p>
        If you grant location permission, your location is used only on your device to center
        the map and find restaurants near you. Your location is never transmitted to our
        servers, stored, or shared with anyone.
      </p>

      <h2>Saved restaurants</h2>
      <p>
        Restaurants you save or watch are stored only on your device. They are not synced to
        any server and are deleted when you uninstall the app.
      </p>

      <h2>Data requests</h2>
      <p>
        When you browse restaurants, the app requests public inspection data from our database
        (hosted by Supabase). These requests are standard internet traffic (your IP address is
        visible to the hosting provider, as with any website) but are not logged or used to
        identify you by us.
      </p>

      <h2>The inspection data</h2>
      <p>
        All restaurant and inspection information shown in the app is public record, published
        by the South Dakota Department of Health and the City of Sioux Falls Health Department.
      </p>

      <h2>Children</h2>
      <p>
        The app does not collect personal information from anyone, including children under 13.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the updated version will be posted at this address with a new
        &quot;last updated&quot; date.
      </p>

      <h2>Contact</h2>
      <p>
        Questions? Email{' '}
        <a href="mailto:michael@blackhillsvinyl.com">michael@blackhillsvinyl.com</a>.
      </p>
    </div>
  );
}
