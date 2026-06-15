import pandas as pd

# ============================================
# CONFIGURATION
# ============================================
SPOTIFY_MATCHES_FILE = 'spotify_matches_final.csv'
DIM_ARTIST_FILE = 'dim_artist.csv'
OUTPUT_FILE = 'dim_artist_with_spotify.csv'

# ============================================
# Main Merge Process
# ============================================
def main():
    print("=" * 60)
    print("🔗 SPOTIFY DATA MERGER")
    print("=" * 60)
    
    # Load files
    print(f"\n1. Loading files...")
    try:
        spotify_matches = pd.read_csv(SPOTIFY_MATCHES_FILE)
        print(f"✅ Loaded {len(spotify_matches)} Spotify matches")
    except FileNotFoundError:
        print(f"❌ ERROR: Could not find {SPOTIFY_MATCHES_FILE}")
        print("Make sure you've run spotify_matcher.py first!")
        exit(1)
    
    try:
        dim_artist = pd.read_csv(DIM_ARTIST_FILE)
        print(f"✅ Loaded {len(dim_artist)} artists from dim_artist")
    except FileNotFoundError:
        print(f"❌ ERROR: Could not find {DIM_ARTIST_FILE}")
        print("Export your dim_artist table to CSV first!")
        exit(1)
    
    # Filter only accepted matches
    print(f"\n2. Filtering accepted matches...")
    accepted = spotify_matches[
        spotify_matches['action'].isin(['auto_accept', 'manual_accept'])
    ]
    print(f"✅ Found {len(accepted)} accepted matches")
    
    rejected = spotify_matches[
        spotify_matches['action'] == 'manual_reject'
    ]
    if len(rejected) > 0:
        print(f"⚠️  Skipping {len(rejected)} manually rejected matches")
    
    not_on_spotify = spotify_matches[
        spotify_matches['action'] == 'not_on_spotify'
    ]
    if len(not_on_spotify) > 0:
        print(f"ℹ️  {len(not_on_spotify)} artists marked as not on Spotify")
    
    needs_review = spotify_matches[
        spotify_matches['action'] == 'review'
    ]
    if len(needs_review) > 0:
        print(f"⚠️  WARNING: {len(needs_review)} matches still need review!")
        print(f"   These will NOT be included in the merge.")
        print(f"   Please review them in {SPOTIFY_MATCHES_FILE} and update 'action' column.")
    
    # Merge Spotify data
    print(f"\n3. Merging Spotify data with dim_artist...")
    
    # Select only needed columns from Spotify matches
    spotify_data = accepted[['artist_id', 'spotify_id', 'spotify_name', 'spotify_url', 'followers', 'popularity', 'genres']].copy()
    
    # Merge with dim_artist
    dim_artist_updated = dim_artist.merge(
        spotify_data,
        on='artist_id',
        how='left'
    )
    
    # Add review_status column
    def get_review_status(row):
        if pd.notna(row.get('spotify_id')):
            return 'verified'
        else:
            artist_id = row['artist_id']
            if artist_id in not_on_spotify['artist_id'].values:
                return 'not_on_spotify'
            else:
                return 'needs_review'
    
    dim_artist_updated['review_status'] = dim_artist_updated.apply(get_review_status, axis=1)
    
    # Save result
    print(f"\n4. Saving to {OUTPUT_FILE}...")
    dim_artist_updated.to_csv(OUTPUT_FILE, index=False)
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ MERGE COMPLETE!")
    print("=" * 60)
    
    with_spotify = dim_artist_updated['spotify_id'].notna().sum()
    without_spotify = dim_artist_updated['spotify_id'].isna().sum()
    
    verified = (dim_artist_updated['review_status'] == 'verified').sum()
    not_on_platform = (dim_artist_updated['review_status'] == 'not_on_spotify').sum()
    needs_review_count = (dim_artist_updated['review_status'] == 'needs_review').sum()
    
    print(f"\nTotal artists: {len(dim_artist_updated)}")
    print(f"  ✅ With Spotify ID: {with_spotify} ({with_spotify/len(dim_artist_updated)*100:.1f}%)")
    print(f"  ❌ Without Spotify ID: {without_spotify} ({without_spotify/len(dim_artist_updated)*100:.1f}%)")
    
    print(f"\nReview status breakdown:")
    print(f"  ✅ Verified: {verified}")
    print(f"  ❌ Not on Spotify: {not_on_platform}")
    print(f"  ⚠️  Needs review: {needs_review_count}")
    
    print(f"\n📁 Output saved to: {OUTPUT_FILE}")
    print(f"\nThis file is ready to upload to Supabase!")
    print("=" * 60)

if __name__ == "__main__":
    main()
