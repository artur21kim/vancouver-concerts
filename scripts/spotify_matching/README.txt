================================================================================
SPOTIFY ARTIST MATCHER - INSTRUCTIONS
================================================================================

This tool automatically matches your artists to Spotify and retrieves their
Spotify IDs, follower counts, and popularity scores.

================================================================================
STEP 1: GET SPOTIFY API CREDENTIALS
================================================================================

1. Go to: https://developer.spotify.com/dashboard
2. Log in with your Spotify account
3. Click "Create App"
4. Fill in:
   - App name: "Vancouver Concert History - Artist Matcher"
   - App description: "Matching concert artists to Spotify"
   - Redirect URI: http://localhost (won't be used)
5. Click "Save"
6. You'll see your Client ID and Client Secret
7. Click "Show Client Secret" to reveal it

================================================================================
STEP 2: PREPARE YOUR DATA
================================================================================

1. Open your Excel file with dim_artist table
2. Export ONLY these two columns to CSV:
   - artist_id
   - artist_name

3. Save as: artists_to_match.csv

Example CSV format:
---
artist_id,artist_name
1,Raincity
2,Dreams2Reality
3,Dayglo Abortions
...
---

================================================================================
STEP 3: CONFIGURE THE SCRIPT
================================================================================

1. Open spotify_matcher.py in a text editor (Notepad, VS Code, etc.)
2. Find lines 10-11:
   CLIENT_ID = 'YOUR_CLIENT_ID_HERE'
   CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE'

3. Replace with your actual credentials from Step 1:
   CLIENT_ID = 'abc123def456...'
   CLIENT_SECRET = 'xyz789uvw012...'

4. Save the file

================================================================================
STEP 4: RUN THE MATCHER
================================================================================

1. Open Command Prompt
2. Navigate to the folder with the scripts:
   cd C:\path\to\your\scripts

3. Run the matcher:
   py spotify_matcher.py

4. Wait ~2 hours while it processes all artists
   (Progress updates every 50 artists)

5. Output file: spotify_matches_final.csv

================================================================================
STEP 5: REVIEW THE RESULTS
================================================================================

Open spotify_matches_final.csv in Excel.

The 'action' column tells you what to do:
- auto_accept = Script is confident, no review needed
- review = You need to check if the match is correct

For rows where action = 'review':

1. Compare artist_name vs spotify_name
2. If they match, change action to: manual_accept
3. If they don't match:
   - Search Spotify manually for the correct artist
   - Update spotify_id with the correct ID
   - Change action to: manual_accept
4. If artist doesn't exist on Spotify:
   - Change action to: not_on_spotify

Save the file when done.

================================================================================
STEP 6: MERGE WITH DIM_ARTIST
================================================================================

1. Make sure you have dim_artist.csv in the same folder
   (Export your full dim_artist table from Excel)

2. Run the merge script:
   py merge_spotify_data.py

3. Output file: dim_artist_with_spotify.csv

This file now has Spotify IDs merged in and is ready to upload to Supabase!

================================================================================
WHAT EACH COLUMN MEANS
================================================================================

In spotify_matches_final.csv:

- artist_id: Your original artist ID
- artist_name: Your original artist name
- spotify_id: Spotify's unique ID for this artist
- spotify_name: How Spotify spells the artist name
- followers: Total Spotify followers
- popularity: Spotify popularity score (0-100)
- genres: Spotify's genre tags
- match_confidence: How confident the script is
  - exact: Names match perfectly
  - high: Names are 95%+ similar
  - medium: Names are 85-95% similar
  - low: Names are <85% similar
  - not_found: No match found on Spotify
- action: What you should do with this row

================================================================================
TROUBLESHOOTING
================================================================================

ERROR: "pip is not recognized"
→ Use: py -m pip install pandas requests

ERROR: "Could not find artists_to_match.csv"
→ Make sure the CSV is in the same folder as the script

ERROR: "Failed to authenticate"
→ Check your CLIENT_ID and CLIENT_SECRET are correct
→ Make sure there are no extra spaces or quotes

ERROR: "Rate limited"
→ Script will automatically wait 30 seconds and retry
→ This is normal if Spotify detects too many requests

================================================================================
ESTIMATED TIME
================================================================================

For 11,666 artists:
- Script runtime: ~2 hours
- Auto-accepted: ~10,500 artists (90%)
- Need manual review: ~1,000 artists (8%) → 2-3 hours of work
- Not found: ~166 artists (2%)

Total time: 5-6 hours (mostly automated)

================================================================================
TIPS
================================================================================

- The script saves progress every 100 artists to spotify_matches_progress.csv
  If it crashes, you can recover from this file

- You can stop the script (Ctrl+C) and resume later
  Just delete any partial rows from the output file first

- Keep your terminal open while running - don't close it!

- The script respects Spotify's rate limits (170 requests/minute)
  Don't try to speed it up or you'll get blocked

================================================================================
